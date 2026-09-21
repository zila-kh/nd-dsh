use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::io::{BufWriter, Read, Write};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

const HIGH_MAX_FRAMES: usize = 256;
const HIGH_MAX_BYTES: usize = 16 * 1024 * 1024;
const NORMAL_MAX_FRAMES: usize = 1024;
const NORMAL_MAX_BYTES: usize = 32 * 1024 * 1024;
const BACKGROUND_MAX_FRAMES: usize = 256;
const BACKGROUND_MAX_BYTES: usize = 16 * 1024 * 1024;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolQueueSnapshot {
    pub queued_frames: usize,
    pub queued_bytes: usize,
    pub queued_high: usize,
    pub queued_normal: usize,
    pub queued_background: usize,
}

#[derive(Debug, Clone, Copy)]
enum OutPriority {
    High,
    Normal,
    Background,
}

struct OutState {
    high: VecDeque<Vec<u8>>,
    normal: VecDeque<Vec<u8>>,
    background: VecDeque<Vec<u8>>,
    high_bytes: usize,
    normal_bytes: usize,
    background_bytes: usize,
    closed: bool,
}

struct OutShared {
    state: Mutex<OutState>,
    ready: Condvar,
}

pub struct ProtocolWriter {
    shared: Arc<OutShared>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl ProtocolWriter {
    pub fn new() -> Self {
        let shared = Arc::new(OutShared {
            state: Mutex::new(OutState {
                high: VecDeque::new(),
                normal: VecDeque::new(),
                background: VecDeque::new(),
                high_bytes: 0,
                normal_bytes: 0,
                background_bytes: 0,
                closed: false,
            }),
            ready: Condvar::new(),
        });
        let writer_shared = Arc::clone(&shared);
        let worker = thread::spawn(move || writer_loop(writer_shared));
        Self {
            shared,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn send_result<T: Serialize>(&self, id: &str, result: &T) -> Result<()> {
        self.enqueue(
            &SuccessFrame {
                version: PROTOCOL_VERSION,
                kind: "response",
                id,
                result,
            },
            OutPriority::High,
        )
    }

    pub fn send_error(&self, id: &str, code: &str, message: impl Into<String>) -> Result<()> {
        self.enqueue(
            &ErrorFrame {
                version: PROTOCOL_VERSION,
                kind: "response",
                id,
                error: WireError {
                    code: code.to_owned(),
                    message: message.into(),
                },
            },
            OutPriority::High,
        )
    }

    pub fn send_event<T: Serialize>(
        &self,
        event: &str,
        resource_id: Option<&str>,
        seq: Option<u64>,
        priority: &str,
        data: &T,
    ) -> Result<()> {
        let out_priority = match priority {
            "high" => OutPriority::High,
            "background" => OutPriority::Background,
            _ => OutPriority::Normal,
        };
        self.enqueue(
            &EventFrame {
                version: PROTOCOL_VERSION,
                kind: "event",
                event,
                resource_id,
                seq,
                priority,
                data,
            },
            out_priority,
        )
    }

    pub fn snapshot(&self) -> ProtocolQueueSnapshot {
        let state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        ProtocolQueueSnapshot {
            queued_frames: state.high.len() + state.normal.len() + state.background.len(),
            queued_bytes: state.high_bytes + state.normal_bytes + state.background_bytes,
            queued_high: state.high.len(),
            queued_normal: state.normal.len(),
            queued_background: state.background.len(),
        }
    }

    fn enqueue<T: Serialize>(&self, value: &T, priority: OutPriority) -> Result<()> {
        let payload = rmp_serde::to_vec_named(value).context("encode MessagePack frame")?;
        if payload.len() > MAX_FRAME_BYTES {
            bail!("encoded protocol frame exceeds {} bytes", MAX_FRAME_BYTES);
        }
        let len = u32::try_from(payload.len()).context("protocol frame too large")?;
        let mut frame = Vec::with_capacity(payload.len() + 4);
        frame.extend_from_slice(&len.to_be_bytes());
        frame.extend_from_slice(&payload);

        let (max_frames, max_bytes) = match priority {
            OutPriority::High => (HIGH_MAX_FRAMES, HIGH_MAX_BYTES),
            OutPriority::Normal => (NORMAL_MAX_FRAMES, NORMAL_MAX_BYTES),
            OutPriority::Background => (BACKGROUND_MAX_FRAMES, BACKGROUND_MAX_BYTES),
        };
        let frame_len = frame.len();
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("protocol output queue lock poisoned"))?;
        loop {
            if state.closed {
                bail!("protocol output is closed");
            }
            let (queue_len, queued_bytes) = match priority {
                OutPriority::High => (state.high.len(), state.high_bytes),
                OutPriority::Normal => (state.normal.len(), state.normal_bytes),
                OutPriority::Background => (state.background.len(), state.background_bytes),
            };
            if queue_len < max_frames && queued_bytes.saturating_add(frame_len) <= max_bytes {
                break;
            }
            state = self
                .shared
                .ready
                .wait(state)
                .map_err(|_| anyhow::anyhow!("protocol output queue lock poisoned"))?;
        }
        match priority {
            OutPriority::High => {
                state.high_bytes += frame_len;
                state.high.push_back(frame);
            }
            OutPriority::Normal => {
                state.normal_bytes += frame_len;
                state.normal.push_back(frame);
            }
            OutPriority::Background => {
                state.background_bytes += frame_len;
                state.background.push_back(frame);
            }
        }
        self.shared.ready.notify_all();
        Ok(())
    }
}

impl Drop for ProtocolWriter {
    fn drop(&mut self) {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.closed = true;
            self.shared.ready.notify_all();
        }
        if let Ok(worker) = self.worker.get_mut()
            && let Some(worker) = worker.take()
        {
            let _ = worker.join();
        }
    }
}

fn writer_loop(shared: Arc<OutShared>) {
    let mut out = BufWriter::new(std::io::stdout());
    loop {
        let frame = {
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            loop {
                if let Some(frame) = pop_frame(&mut state) {
                    shared.ready.notify_all();
                    break frame;
                }
                if state.closed {
                    let _ = out.flush();
                    return;
                }
                state = shared
                    .ready
                    .wait(state)
                    .unwrap_or_else(|error| error.into_inner());
            }
        };
        if let Err(error) = out.write_all(&frame).and_then(|_| out.flush()) {
            eprintln!("[nd-core] protocol stdout write failed: {error}");
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            state.closed = true;
            state.high.clear();
            state.normal.clear();
            state.background.clear();
            state.high_bytes = 0;
            state.normal_bytes = 0;
            state.background_bytes = 0;
            shared.ready.notify_all();
            return;
        }
    }
}

fn pop_frame(state: &mut OutState) -> Option<Vec<u8>> {
    if let Some(frame) = state.high.pop_front() {
        state.high_bytes = state.high_bytes.saturating_sub(frame.len());
        return Some(frame);
    }
    if let Some(frame) = state.normal.pop_front() {
        state.normal_bytes = state.normal_bytes.saturating_sub(frame.len());
        return Some(frame);
    }
    if let Some(frame) = state.background.pop_front() {
        state.background_bytes = state.background_bytes.saturating_sub(frame.len());
        return Some(frame);
    }
    None
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;

    fn framed(value: serde_json::Value) -> Vec<u8> {
        let payload = rmp_serde::to_vec_named(&value).unwrap();
        let mut bytes = Vec::with_capacity(payload.len() + 4);
        bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&payload);
        bytes
    }

    #[test]
    fn accepts_one_valid_request_frame() {
        let bytes = framed(json!({
            "version": PROTOCOL_VERSION,
            "kind": "request",
            "id": "request-1",
            "method": "core.health",
            "params": {}
        }));
        let request = read_request(&mut Cursor::new(bytes)).unwrap().unwrap();
        assert_eq!(request.id, "request-1");
        assert_eq!(request.method, "core.health");
    }

    #[test]
    fn rejects_zero_and_oversized_frame_lengths() {
        let zero = 0u32.to_be_bytes().to_vec();
        assert!(read_request(&mut Cursor::new(zero)).is_err());

        let oversized = (u32::try_from(MAX_FRAME_BYTES).unwrap() + 1)
            .to_be_bytes()
            .to_vec();
        let error = read_request(&mut Cursor::new(oversized)).unwrap_err();
        assert!(format!("{error:#}").contains("invalid protocol frame length"));
    }

    #[test]
    fn rejects_malformed_messagepack_and_wrong_protocol_version() {
        let mut malformed = 1u32.to_be_bytes().to_vec();
        malformed.push(0xc1);
        assert!(read_request(&mut Cursor::new(malformed)).is_err());

        let wrong_version = framed(json!({
            "version": PROTOCOL_VERSION + 1,
            "kind": "request",
            "id": "request-2",
            "method": "core.health",
            "params": {}
        }));
        let error = read_request(&mut Cursor::new(wrong_version)).unwrap_err();
        assert!(format!("{error:#}").contains("protocol version mismatch"));
    }
}
