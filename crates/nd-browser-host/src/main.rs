use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::json;
use std::env;
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

#[cfg(unix)]
type LocalStream = std::os::unix::net::UnixStream;

#[cfg(windows)]
type LocalStream = windows_pipe::OverlappedPipe;

/// Windows coordinates I/O on a synchronous pipe handle: while one thread holds
/// a pending read, a write from the other thread waits for that read to finish.
/// A command/response round trip therefore stalled until the desktop sent fresh
/// traffic, which never happens while it awaits the response. Overlapped I/O
/// with one event per direction is the documented way to keep both directions
/// of a named pipe live at once.
#[cfg(windows)]
mod windows_pipe {
    use anyhow::{Context, Result};
    use std::io::{self, Read, Write};
    use std::mem;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use windows_sys::Win32::Foundation::{
        ERROR_BROKEN_PIPE, ERROR_IO_PENDING, HANDLE, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows_sys::Win32::System::IO::{GetOverlappedResult, OVERLAPPED};
    use windows_sys::Win32::System::Threading::{
        CreateEventW, INFINITE, ResetEvent, WaitForSingleObject,
    };

    const FILE_FLAG_OVERLAPPED: u32 = 0x4000_0000;

    pub struct OverlappedPipe {
        handle: OwnedHandle,
        read_event: OwnedHandle,
        write_event: OwnedHandle,
    }

    impl OverlappedPipe {
        pub fn connect(endpoint: &str) -> Result<Self> {
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .custom_flags(FILE_FLAG_OVERLAPPED)
                .open(endpoint)
                .with_context(|| format!("open ND browser pipe {endpoint}"))?;
            Ok(Self {
                handle: OwnedHandle::from(file),
                read_event: completion_event()?,
                write_event: completion_event()?,
            })
        }

        pub fn try_clone(&self) -> Result<Self> {
            Ok(Self {
                handle: self.handle.try_clone()?,
                read_event: completion_event()?,
                write_event: completion_event()?,
            })
        }

        fn transfer(&self, buffer: *mut u8, length: usize, outbound: bool) -> io::Result<u32> {
            let length = length.min(u32::MAX as usize) as u32;
            let handle: HANDLE = self.handle.as_raw_handle() as HANDLE;
            let event: HANDLE = if outbound {
                self.write_event.as_raw_handle() as HANDLE
            } else {
                self.read_event.as_raw_handle() as HANDLE
            };
            // One operation per direction is ever in flight, so clearing the
            // event here keeps it from reporting an earlier completion.
            unsafe { ResetEvent(event) };
            let mut overlapped: OVERLAPPED = unsafe { mem::zeroed() };
            overlapped.hEvent = event;
            let mut transferred = 0u32;
            let started = unsafe {
                if outbound {
                    WriteFile(handle, buffer, length, &mut transferred, &mut overlapped)
                } else {
                    ReadFile(handle, buffer, length, &mut transferred, &mut overlapped)
                }
            };
            if started != 0 {
                return Ok(transferred);
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
                return Err(error);
            }
            if unsafe { WaitForSingleObject(event, INFINITE) } != WAIT_OBJECT_0 {
                return Err(io::Error::last_os_error());
            }
            if unsafe { GetOverlappedResult(handle, &overlapped, &mut transferred, 0) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(transferred)
        }
    }

    fn completion_event() -> Result<OwnedHandle> {
        let handle = unsafe { CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error().into());
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) })
    }

    impl Read for OverlappedPipe {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            match self.transfer(buf.as_mut_ptr(), buf.len(), false) {
                Ok(transferred) => Ok(transferred as usize),
                // The desktop closed the pipe: report EOF rather than a failure.
                Err(error) if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) => Ok(0),
                Err(error) => Err(error),
            }
        }
    }

    impl Write for OverlappedPipe {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.transfer(buf.as_ptr().cast_mut(), buf.len(), true)
                .map(|transferred| transferred as usize)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
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
