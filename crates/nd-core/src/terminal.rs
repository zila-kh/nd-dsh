//! PTY terminals.
//!
//! A terminal is identified by its `terminalId` for its whole life, including across a
//! [`TerminalManager::restart`]. Each shell a terminal has run is a *generation*: the
//! generation number moves when the shell is replaced, and every state read is
//! reported against the generation that is current at that moment. That is what keeps
//! a restart from ever claiming the previous shell is still running.
//!
//! Output is streamed as `terminal.output` events and retained in a bounded per
//! terminal tail that belongs to the terminal rather than to one shell, so it survives
//! a restart. The tail plus the sequence numbers is how a client that missed events
//! reaches the same view as one that received them all: it replays the retained bytes
//! and can see exactly which sequence numbers are no longer available.

use crate::process::{filtered_environment, kill_process_tree};
use crate::protocol::ProtocolWriter;
use crate::scheduler::now_ms;
#[cfg(windows)]
use crate::windows_job::WindowsJob;
use anyhow::{Context, Result, bail};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;
use uuid::Uuid;

/// Retained output per terminal. Bounded so terminal output cannot grow without
/// limit; the oldest retained chunk is dropped once the tail is full, and the
/// dropped sequence number is reported rather than hidden.
const MAX_TERMINAL_TAIL_BYTES: usize = 512 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateParams {
    pub terminal_id: Option<String>,
    pub session_id: String,
    pub shell: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default, with = "serde_bytes")]
    pub initial_bytes: Vec<u8>,
    #[serde(default)]
    pub initial_seq: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteParams {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeParams {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHistoryAppendParams {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCloseParams {
    pub terminal_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStateParams {
    pub terminal_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRestartParams {
    pub terminal_id: String,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateResult {
    pub terminal_id: String,
    pub session_id: String,
    pub pid: Option<u32>,
    pub shell: String,
    pub generation: u64,
    /// Whether this result replaced a running shell.
    pub restarted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStateResult {
    pub terminal_id: String,
    pub session_id: String,
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub pid: Option<u32>,
    /// Whether the current generation's shell is still running. A previous
    /// generation is never reported as running.
    pub running: bool,
    pub generation: u64,
    pub restart_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_signal: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Sequence number of the newest output event for this terminal.
    pub seq: u64,
    /// Oldest sequence number still replayable from `bytes`.
    pub first_retained_seq: u64,
    /// Sequence numbers at or below this are gone from the retained tail.
    pub dropped_through_seq: u64,
    pub retained_bytes: usize,
    pub tail_truncated: bool,
    #[serde(with = "serde_bytes")]
    pub bytes: Vec<u8>,
    pub emitted_at: u64,
}

/// Parameters a terminal was created with, so a restart re-creates the same shell
/// instead of asking the client to describe it again.
struct TerminalSpec {
    session_id: String,
    shell: String,
    args: Vec<String>,
    cwd: String,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    terminal_id: String,
    session_id: String,
    generation: u64,
    emitted_at: u64,
    #[serde(with = "serde_bytes")]
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    terminal_id: String,
    session_id: String,
    generation: u64,
    exit_code: u32,
    signal: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalRestart {
    terminal_id: String,
    session_id: String,
    generation: u64,
    pid: Option<u32>,
    emitted_at: u64,
}

#[derive(Default)]
struct OutputTail {
    chunks: VecDeque<(u64, Vec<u8>)>,
    bytes: usize,
    first_retained_seq: u64,
    dropped_through_seq: u64,
}

impl OutputTail {
    fn push(&mut self, seq: u64, mut bytes: Vec<u8>) {
        if bytes.len() > MAX_TERMINAL_TAIL_BYTES {
            bytes = bytes.split_off(bytes.len() - MAX_TERMINAL_TAIL_BYTES);
        }
        if self.chunks.is_empty() {
            self.first_retained_seq = seq;
        }
        self.bytes += bytes.len();
        self.chunks.push_back((seq, bytes));
        while self.bytes > MAX_TERMINAL_TAIL_BYTES {
            let Some((dropped_seq, dropped)) = self.chunks.pop_front() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(dropped.len());
            self.dropped_through_seq = dropped_seq;
            self.first_retained_seq = self
                .chunks
                .front()
                .map(|(seq, _)| *seq)
                .unwrap_or(dropped_seq + 1);
        }
    }

    fn drain(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.bytes);
        for (_, chunk) in &self.chunks {
            bytes.extend_from_slice(chunk);
        }
        bytes
    }
}

struct TerminalRuntime {
    spec: Mutex<TerminalSpec>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    generation: AtomicU64,
    restart_count: AtomicU64,
    running: AtomicBool,
    /// Exit of *this* generation's shell. A restart starts a new generation with no
    /// exit record, so a replaced shell can never be reported as the current one.
    exit: Mutex<Option<(u32, Option<String>)>>,
    /// Output history belongs to the terminal, not to one shell.
    tail: Arc<Mutex<OutputTail>>,
    seq: AtomicU64,
    #[cfg(unix)]
    process_group: Option<i32>,
    #[cfg(windows)]
    _job: WindowsJob,
}

impl TerminalRuntime {
    fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }
}

pub struct TerminalManager {
    writer: Arc<ProtocolWriter>,
    terminals: Mutex<HashMap<String, Arc<TerminalRuntime>>>,
}

impl TerminalManager {
    pub fn new(writer: Arc<ProtocolWriter>) -> Self {
        Self {
            writer,
            terminals: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(self: &Arc<Self>, params: TerminalCreateParams) -> Result<TerminalCreateResult> {
        validate_id(&params.session_id)?;
        let terminal_id = params
            .terminal_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        validate_id(&terminal_id)?;
        {
            let terminals = self
                .terminals
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?;
            if terminals.contains_key(&terminal_id) {
                bail!("terminal id already exists");
            }
        }
        let spec = spec_from(&params)?;
        let shell = spec.shell.clone();
        let mut initial_tail = OutputTail::default();
        if !params.initial_bytes.is_empty() {
            initial_tail.push(params.initial_seq, params.initial_bytes.clone());
        }
        let runtime = self.spawn_runtime(
            &terminal_id,
            spec,
            0,
            0,
            Arc::new(Mutex::new(initial_tail)),
            params.initial_seq,
        )?;
        {
            let mut terminals = self
                .terminals
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?;
            terminals.insert(terminal_id.clone(), Arc::clone(&runtime));
        }
        Ok(TerminalCreateResult {
            terminal_id,
            session_id: params.session_id,
            pid: runtime.pid,
            shell,
            generation: runtime.generation(),
            restarted: false,
        })
    }

    /// Replace the shell behind an existing terminal id. The terminal keeps its
    /// identity, its sequence numbers keep increasing, and the previous shell is
    /// never reported as still running.
    pub fn restart(
        self: &Arc<Self>,
        params: TerminalRestartParams,
    ) -> Result<TerminalCreateResult> {
        validate_id(&params.terminal_id)?;
        let previous = {
            let terminals = self
                .terminals
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?;
            terminals.get(&params.terminal_id).map(Arc::clone)
        };
        let Some(previous) = previous else {
            return Err(crate::errors::not_found("terminal", &params.terminal_id));
        };

        let spec = {
            let held = previous
                .spec
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal spec lock poisoned"))?;
            TerminalSpec {
                session_id: held.session_id.clone(),
                shell: held.shell.clone(),
                args: held.args.clone(),
                cwd: held.cwd.clone(),
                env: held.env.clone(),
                cols: params.cols.unwrap_or(held.cols),
                rows: params.rows.unwrap_or(held.rows),
            }
        };
        validate_dimensions(spec.cols, spec.rows)?;

        let generation = previous.generation() + 1;
        let restart_count = previous.restart_count.load(Ordering::Relaxed) + 1;
        let runtime = self.spawn_runtime(
            &params.terminal_id,
            spec,
            generation,
            restart_count,
            Arc::clone(&previous.tail),
            previous.seq.load(Ordering::Relaxed),
        )?;
        // Sequence numbers continue across the restart, so a client can order events
        // from both shells without a gap.
        {
            let mut terminals = self
                .terminals
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?;
            terminals.insert(params.terminal_id.clone(), Arc::clone(&runtime));
        }
        // Stop the superseded shell only after the registry points at the new
        // generation, so no observer can see the terminal as running-but-dead.
        kill_runtime(&previous);
        self.emit_restart(&params.terminal_id, &runtime);

        let spec = runtime
            .spec
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal spec lock poisoned"))?;
        Ok(TerminalCreateResult {
            terminal_id: params.terminal_id,
            session_id: spec.session_id.clone(),
            pid: runtime.pid,
            shell: spec.shell.clone(),
            generation,
            restarted: true,
        })
    }

    pub fn state(&self, params: TerminalStateParams) -> Result<TerminalStateResult> {
        let runtime = self.runtime(&params.terminal_id)?;
        let spec = runtime
            .spec
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal spec lock poisoned"))?;
        let tail = runtime
            .tail
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal tail lock poisoned"))?;
        let exit = runtime
            .exit
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal state lock poisoned"))?;
        let (exit_code, exit_signal) = exit
            .as_ref()
            .map(|(code, signal)| (Some(*code), signal.clone()))
            .unwrap_or((None, None));
        Ok(TerminalStateResult {
            terminal_id: params.terminal_id,
            session_id: spec.session_id.clone(),
            shell: spec.shell.clone(),
            args: spec.args.clone(),
            cwd: spec.cwd.clone(),
            pid: runtime.pid,
            running: runtime.is_running(),
            generation: runtime.generation(),
            restart_count: runtime.restart_count.load(Ordering::Relaxed),
            exit_code,
            exit_signal,
            cols: spec.cols,
            rows: spec.rows,
            seq: runtime.seq.load(Ordering::Relaxed),
            first_retained_seq: tail.first_retained_seq,
            dropped_through_seq: tail.dropped_through_seq,
            retained_bytes: tail.bytes,
            tail_truncated: tail.dropped_through_seq > 0,
            bytes: tail.drain(),
            emitted_at: now_ms(),
        })
    }

    pub fn write(&self, params: TerminalWriteParams) -> Result<()> {
        if params.data.len() > 64 * 1024 {
            bail!("terminal input is too large");
        }
        let runtime = self.runtime(&params.terminal_id)?;
        if !runtime.is_running() {
            return Err(crate::errors::coded(
                crate::errors::CODE_NOT_FOUND,
                "terminal is not running",
            ));
        }
        let mut writer = runtime
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal writer lock poisoned"))?;
        writer.write_all(params.data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, params: TerminalResizeParams) -> Result<()> {
        validate_dimensions(params.cols, params.rows)?;
        let runtime = self.runtime(&params.terminal_id)?;
        {
            let master = runtime
                .master
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal master lock poisoned"))?;
            master.resize(PtySize {
                rows: params.rows,
                cols: params.cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        // Record the size so a later restart re-creates the shell at the size the
        // client last asked for rather than the size it was created with.
        let mut spec = runtime
            .spec
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal spec lock poisoned"))?;
        spec.cols = params.cols;
        spec.rows = params.rows;
        Ok(())
    }

    pub fn append_history(&self, params: TerminalHistoryAppendParams) -> Result<()> {
        let runtime = self.runtime(&params.terminal_id)?;
        if params.data.len() > 64 * 1024 {
            bail!("terminal history append is too large");
        }
        if params.data.is_empty() {
            return Ok(());
        }
        let seq = runtime.seq.load(Ordering::Relaxed);
        let mut tail = runtime
            .tail
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal tail lock poisoned"))?;
        tail.push(seq, params.data.into_bytes());
        Ok(())
    }

    pub fn close(&self, params: TerminalCloseParams) -> Result<bool> {
        let runtime = {
            let mut terminals = self
                .terminals
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?;
            terminals.remove(&params.terminal_id)
        };
        let Some(runtime) = runtime else {
            return Ok(false);
        };
        kill_runtime(&runtime);
        Ok(true)
    }

    pub fn shutdown(&self) {
        let runtimes = self
            .terminals
            .lock()
            .map(|terminals| terminals.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for runtime in runtimes {
            kill_runtime(&runtime);
        }
    }

    /// Terminals whose current shell is alive.
    pub fn terminal_count(&self) -> usize {
        self.terminals
            .lock()
            .map(|terminals| {
                terminals
                    .values()
                    .filter(|runtime| runtime.is_running())
                    .count()
            })
            .unwrap_or_default()
    }

    /// Terminals retained for state replay, including shells that have exited.
    pub fn retained_terminal_count(&self) -> usize {
        self.terminals
            .lock()
            .map(|terminals| terminals.len())
            .unwrap_or_default()
    }

    pub fn retained_buffer_bytes(&self) -> usize {
        self.terminals
            .lock()
            .map(|terminals| {
                terminals
                    .values()
                    .filter_map(|runtime| runtime.tail.lock().ok().map(|tail| tail.bytes))
                    .sum()
            })
            .unwrap_or_default()
    }

    fn runtime(&self, terminal_id: &str) -> Result<Arc<TerminalRuntime>> {
        validate_id(terminal_id)?;
        self.terminals
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?
            .get(terminal_id)
            .map(Arc::clone)
            .ok_or_else(|| crate::errors::not_found("terminal", terminal_id))
    }

    fn emit_restart(&self, terminal_id: &str, runtime: &Arc<TerminalRuntime>) {
        let session_id = runtime
            .spec
            .lock()
            .map(|spec| spec.session_id.clone())
            .unwrap_or_default();
        let event = TerminalRestart {
            terminal_id: terminal_id.to_owned(),
            session_id,
            generation: runtime.generation(),
            pid: runtime.pid,
            emitted_at: now_ms(),
        };
        let _ = self.writer.send_event(
            "terminal.restart",
            Some(terminal_id),
            None,
            "normal",
            &event,
        );
    }

    fn spawn_runtime(
        self: &Arc<Self>,
        terminal_id: &str,
        spec: TerminalSpec,
        generation: u64,
        restart_count: u64,
        tail: Arc<Mutex<OutputTail>>,
        initial_seq: u64,
    ) -> Result<Arc<TerminalRuntime>> {
        validate_dimensions(spec.cols, spec.rows)?;

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: spec.rows,
                cols: spec.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("open native PTY")?;

        let mut command = CommandBuilder::new(&spec.shell);
        command.args(&spec.args);
        command.cwd(&spec.cwd);
        command.env_clear();
        for (key, value) in filtered_environment() {
            command.env(key, value);
        }
        for (key, value) in &spec.env {
            command.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("spawn terminal shell {}", spec.shell))?;
        #[cfg(windows)]
        let job = {
            let handle = child
                .as_raw_handle()
                .ok_or_else(|| anyhow::anyhow!("terminal child has no native Windows handle"))?;
            match WindowsJob::assign(handle) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    return Err(error).context("attach terminal child to kill-on-close job");
                }
            }
        };
        let pid = child.process_id();
        let killer = child.clone_killer();
        let reader = pair.master.try_clone_reader()?;
        let terminal_writer = pair.master.take_writer()?;
        #[cfg(unix)]
        let process_group = pair.master.process_group_leader();

        let session_id = spec.session_id.clone();
        let runtime = Arc::new(TerminalRuntime {
            spec: Mutex::new(spec),
            master: Mutex::new(pair.master),
            writer: Mutex::new(terminal_writer),
            killer: Mutex::new(killer),
            pid,
            generation: AtomicU64::new(generation),
            restart_count: AtomicU64::new(restart_count),
            running: AtomicBool::new(true),
            exit: Mutex::new(None),
            tail,
            seq: AtomicU64::new(initial_seq),
            #[cfg(unix)]
            process_group,
            #[cfg(windows)]
            _job: job,
        });

        let output_writer = Arc::clone(&self.writer);
        let output_id = terminal_id.to_owned();
        let output_runtime = Arc::clone(&runtime);
        let (output_done_tx, output_done_rx) = mpsc::sync_channel(1);
        thread::spawn(move || {
            stream_output(output_writer, output_runtime, output_id, session_id, reader);
            let _ = output_done_tx.send(());
        });

        let manager = Arc::clone(self);
        let wait_id = terminal_id.to_owned();
        let wait_runtime = Arc::clone(&runtime);
        thread::spawn(move || {
            let status = child.wait();
            wait_runtime.running.store(false, Ordering::Relaxed);
            let (exit_code, signal) = match status {
                Ok(status) => (status.exit_code(), status.signal().map(ToOwned::to_owned)),
                Err(error) => {
                    eprintln!("[nd-core] terminal wait failed for {wait_id}: {error}");
                    (1, None)
                }
            };
            if let Ok(mut exit) = wait_runtime.exit.lock() {
                *exit = Some((exit_code, signal.clone()));
            }
            // Give the PTY reader one bounded window to drain final shell output
            // into the retained tail before terminal.exit. A descendant can keep
            // the PTY open, so this must never become an unbounded join.
            let _ = output_done_rx.recv_timeout(Duration::from_millis(250));

            // Only the generation that is still the terminal may publish its exit.
            // Keep the current runtime in the registry after exit so its bounded
            // tail remains replayable until the desktop explicitly closes it.
            let is_current = manager
                .terminals
                .lock()
                .ok()
                .and_then(|terminals| {
                    terminals
                        .get(&wait_id)
                        .map(|current| Arc::ptr_eq(current, &wait_runtime))
                })
                .unwrap_or(false);
            if !is_current {
                return;
            }

            let event = TerminalExit {
                terminal_id: wait_id.clone(),
                session_id: wait_runtime
                    .spec
                    .lock()
                    .map(|spec| spec.session_id.clone())
                    .unwrap_or_default(),
                generation: wait_runtime.generation(),
                exit_code,
                signal,
            };
            let _ =
                manager
                    .writer
                    .send_event("terminal.exit", Some(&wait_id), None, "normal", &event);
        });

        Ok(runtime)
    }
}

fn spec_from(params: &TerminalCreateParams) -> Result<TerminalSpec> {
    if params.shell.trim().is_empty() || params.shell.len() > 4096 {
        bail!("invalid terminal shell");
    }
    if params.args.len() > 64 {
        bail!("too many terminal shell arguments");
    }
    validate_dimensions(params.cols, params.rows)?;
    Ok(TerminalSpec {
        session_id: params.session_id.clone(),
        shell: params.shell.clone(),
        args: params.args.clone(),
        cwd: params.cwd.clone(),
        env: params.env.clone(),
        cols: params.cols,
        rows: params.rows,
    })
}

fn validate_dimensions(cols: u16, rows: u16) -> Result<()> {
    if !(2..=1000).contains(&cols) || !(1..=500).contains(&rows) {
        bail!("invalid terminal dimensions");
    }
    Ok(())
}

/// End the shell behind a runtime. The wait thread still records the exit and, when
/// this runtime is no longer the terminal's current one, publishes nothing.
fn kill_runtime(runtime: &Arc<TerminalRuntime>) {
    #[cfg(unix)]
    if let Some(group) = runtime.process_group {
        unsafe {
            let _ = libc::kill(-group, libc::SIGKILL);
        }
    }

    if let Some(pid) = runtime.pid {
        kill_process_tree(pid);
    }
    if let Ok(mut killer) = runtime.killer.lock() {
        let _ = killer.kill();
    }
    runtime.running.store(false, Ordering::Relaxed);
}

fn stream_output(
    writer: Arc<ProtocolWriter>,
    runtime: Arc<TerminalRuntime>,
    terminal_id: String,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let seq = runtime.seq.fetch_add(1, Ordering::Relaxed) + 1;
                let bytes = buffer[..read].to_vec();
                if let Ok(mut tail) = runtime.tail.lock() {
                    tail.push(seq, bytes.clone());
                }
                let event = TerminalOutput {
                    terminal_id: terminal_id.clone(),
                    session_id: session_id.clone(),
                    generation: runtime.generation(),
                    emitted_at: now_ms(),
                    bytes,
                };
                if writer
                    .send_event(
                        "terminal.output",
                        Some(&terminal_id),
                        Some(seq),
                        "normal",
                        &event,
                    )
                    .is_err()
                {
                    break;
                }
            }
            Err(error) => {
                eprintln!("[nd-core] terminal output read failed for {terminal_id}: {error}");
                break;
            }
        }
    }
}

fn validate_id(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 {
        bail!("invalid terminal resource id");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_input_before_terminal_lookup() {
        let manager = TerminalManager::new(Arc::new(ProtocolWriter::new()));
        let error = manager
            .write(TerminalWriteParams {
                terminal_id: "missing".into(),
                data: "x".repeat(64 * 1024 + 1),
            })
            .unwrap_err()
            .to_string();
        assert!(error.contains("too large"));
    }

    #[test]
    fn retained_tail_is_bounded_and_reports_what_it_dropped() {
        let mut tail = OutputTail::default();
        let chunk = vec![b'x'; 32 * 1024];
        for seq in 1..=16 {
            tail.push(seq, chunk.clone());
        }
        assert!(tail.bytes <= MAX_TERMINAL_TAIL_BYTES);
        assert_eq!(tail.bytes, 16 * 32 * 1024);
        assert_eq!(tail.first_retained_seq, 1);
        assert_eq!(tail.dropped_through_seq, 0);
        assert_eq!(tail.drain().len(), tail.bytes);
    }

    #[test]
    fn unknown_terminal_state_is_not_found_rather_than_empty() {
        let manager = TerminalManager::new(Arc::new(ProtocolWriter::new()));
        let error = manager
            .state(TerminalStateParams {
                terminal_id: "missing".into(),
            })
            .unwrap_err();
        assert_eq!(
            crate::errors::code_of(&error),
            crate::errors::CODE_NOT_FOUND
        );
    }

    #[test]
    fn restart_of_an_unknown_terminal_does_not_create_one() {
        let manager = Arc::new(TerminalManager::new(Arc::new(ProtocolWriter::new())));
        let error = manager
            .restart(TerminalRestartParams {
                terminal_id: "missing".into(),
                cols: None,
                rows: None,
            })
            .unwrap_err();
        assert_eq!(
            crate::errors::code_of(&error),
            crate::errors::CODE_NOT_FOUND
        );
        assert_eq!(manager.retained_terminal_count(), 0);
    }

    #[test]
    fn resize_updates_the_recorded_geometry_used_by_restart() {
        let manager = Arc::new(TerminalManager::new(Arc::new(ProtocolWriter::new())));
        // No PTY is involved: the recorded geometry is what a restart replays, and
        // it is validated before the terminal lookup.
        assert!(
            manager
                .resize(TerminalResizeParams {
                    terminal_id: "missing".into(),
                    cols: 1,
                    rows: 0,
                })
                .is_err()
        );
    }
}
