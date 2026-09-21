use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufWriter, Read, Stdout, Write};
use std::sync::Mutex;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestFrame {
    pub version: u16,
    pub kind: String,
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SuccessFrame<'a, T: Serialize> {
    version: u16,
    kind: &'static str,
    id: &'a str,
    result: &'a T,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorFrame<'a> {
    version: u16,
    kind: &'static str,
    id: &'a str,
    error: WireError,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventFrame<'a, T: Serialize> {
    version: u16,
    kind: &'static str,
    event: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<u64>,
    priority: &'a str,
    data: &'a T,
}

pub struct ProtocolWriter {
    inner: Mutex<BufWriter<Stdout>>,
}

impl ProtocolWriter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(BufWriter::new(std::io::stdout())),
        }
    }

    pub fn send_result<T: Serialize>(&self, id: &str, result: &T) -> Result<()> {
        self.write(&SuccessFrame {
            version: PROTOCOL_VERSION,
            kind: "response",
            id,
            result,
        })
    }

    pub fn send_error(&self, id: &str, code: &str, message: impl Into<String>) -> Result<()> {
        self.write(&ErrorFrame {
            version: PROTOCOL_VERSION,
            kind: "response",
            id,
            error: WireError {
                code: code.to_owned(),
                message: message.into(),
            },
        })
    }

    pub fn send_event<T: Serialize>(
        &self,
        event: &str,
        resource_id: Option<&str>,
        seq: Option<u64>,
        priority: &str,
        data: &T,
    ) -> Result<()> {
        self.write(&EventFrame {
            version: PROTOCOL_VERSION,
            kind: "event",
            event,
            resource_id,
            seq,
            priority,
            data,
        })
    }

    fn write<T: Serialize>(&self, value: &T) -> Result<()> {
        let payload = rmp_serde::to_vec_named(value).context("encode MessagePack frame")?;
        if payload.len() > MAX_FRAME_BYTES {
            bail!("encoded protocol frame exceeds {} bytes", MAX_FRAME_BYTES);
        }
        let len = u32::try_from(payload.len()).context("protocol frame too large")?;
        let mut out = self
            .inner
            .lock()
            .map_err(|_| anyhow::anyhow!("protocol stdout writer lock poisoned"))?;
        out.write_all(&len.to_be_bytes())?;
        out.write_all(&payload)?;
        out.flush()?;
        Ok(())
    }
}

pub fn read_request<R: Read>(input: &mut R) -> Result<Option<RequestFrame>> {
    let mut header = [0u8; 4];
    match input.read(&mut header[..1])? {
        0 => return Ok(None),
        1 => {}
        _ => unreachable!(),
    }
    input.read_exact(&mut header[1..])?;
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        bail!("invalid protocol frame length: {length}");
    }
    let mut payload = vec![0u8; length];
    input.read_exact(&mut payload)?;
    let frame: RequestFrame =
        rmp_serde::from_slice(&payload).context("decode MessagePack request")?;
    if frame.version != PROTOCOL_VERSION {
        bail!(
            "protocol version mismatch: expected {}, received {}",
            PROTOCOL_VERSION,
            frame.version
        );
    }
    if frame.kind != "request" {
        bail!("unsupported inbound frame kind: {}", frame.kind);
    }
    if frame.id.is_empty() || frame.id.len() > 256 {
        bail!("invalid request id");
    }
    if frame.method.is_empty() || frame.method.len() > 128 {
        bail!("invalid request method");
    }
    Ok(Some(frame))
}
