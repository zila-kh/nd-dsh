use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::json;
use std::env;
#[cfg(not(unix))]
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::thread;

const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Deserialize)]
struct Discovery {
    version: u16,
    endpoint: String,
    token: String,
}

enum LocalStream {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
    #[cfg(not(unix))]
    File(File),
}

impl LocalStream {
    fn connect(endpoint: &str) -> Result<Self> {
        #[cfg(unix)]
        {
            return Ok(Self::Unix(
                std::os::unix::net::UnixStream::connect(endpoint)
                    .with_context(|| format!("connect ND browser socket {endpoint}"))?,
            ));
        }
        #[cfg(not(unix))]
        {
            Ok(Self::File(
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(endpoint)
                    .with_context(|| format!("open ND browser pipe {endpoint}"))?,
            ))
        }
    }

    fn try_clone(&self) -> Result<Self> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => Ok(Self::Unix(stream.try_clone()?)),
            #[cfg(not(unix))]
            Self::File(file) => Ok(Self::File(file.try_clone()?)),
        }
    }
}

impl Read for LocalStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.read(buf),
            #[cfg(not(unix))]
            Self::File(file) => file.read(buf),
        }
    }
}

impl Write for LocalStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.write(buf),
            #[cfg(not(unix))]
            Self::File(file) => file.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.flush(),
            #[cfg(not(unix))]
            Self::File(file) => file.flush(),
        }
    }
}

fn main() -> Result<()> {
    let discovery = read_discovery()?;
    if discovery.version != PROTOCOL_VERSION {
        bail!(
            "unsupported browser companion protocol {}",
            discovery.version
        );
    }

    let mut outbound = LocalStream::connect(&discovery.endpoint)?;
    let inbound = outbound.try_clone()?;
    writeln!(
        outbound,
        "{}",
        json!({
            "version": PROTOCOL_VERSION,
            "kind": "auth",
            "token": discovery.token,
            "client": "native-host"
        })
    )?;
    outbound.flush()?;

    let _writer = thread::spawn(move || -> Result<()> {
        let stdout = io::stdout();
        let mut stdout = stdout.lock();
        let reader = BufReader::new(inbound);
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            serde_json::from_str::<serde_json::Value>(&line)
                .context("ND browser host received invalid JSON")?;
            write_native_message(&mut stdout, line.as_bytes())?;
        }
        Ok(())
    });

    let stdin = io::stdin();
    let mut stdin = stdin.lock();
    while let Some(message) = read_native_message(&mut stdin)? {
        serde_json::from_slice::<serde_json::Value>(&message)
            .context("Chrome sent invalid native-message JSON")?;
        outbound.write_all(&message)?;
        outbound.write_all(b"\n")?;
        outbound.flush()?;
    }

    // Chrome closes stdin when it disconnects the native host. Do not join the
    // desktop->Chrome reader here: that reader owns a clone of the same local
    // socket/pipe, so waiting for it would create a shutdown deadlock while the
    // desktop waits for this process to disconnect.
    Ok(())
}

fn read_discovery() -> Result<Discovery> {
    let path = discovery_path()?;
    let bytes = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_slice(&bytes).context("parse ND browser companion discovery file")
}

fn discovery_path() -> Result<PathBuf> {
    if let Ok(value) = env::var("ND_BROWSER_COMPANION_DISCOVERY")
        && !value.trim().is_empty()
    {
        return Ok(PathBuf::from(value));
    }
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .context("resolve home directory for ND browser companion")?;
    Ok(home.join(".nd-dsh").join("browser-companion.json"))
}

fn read_native_message<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    let mut read = 0usize;
    while read < len.len() {
        match reader.read(&mut len[read..])? {
            0 if read == 0 => return Ok(None),
            0 => bail!("truncated native-message length prefix"),
            count => read += count,
        }
    }
    let size = u32::from_le_bytes(len) as usize;
    if size == 0 || size > MAX_FRAME_BYTES {
        bail!("native-message frame size {size} is invalid");
    }
    let mut payload = vec![0u8; size];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_native_message<W: Write>(writer: &mut W, payload: &[u8]) -> Result<()> {
    if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
        bail!("native-message response size {} is invalid", payload.len());
    }
    writer.write_all(&(payload.len() as u32).to_le_bytes())?;
    writer.write_all(payload)?;
    writer.flush()?;
    Ok(())
}
