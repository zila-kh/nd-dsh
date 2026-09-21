use crate::process::{filtered_environment, kill_process_tree};
use crate::protocol::ProtocolWriter;
use anyhow::{bail, Context, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use uuid::Uuid;

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
pub struct TerminalCloseParams {
    pub terminal_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateResult {
    pub terminal_id: String,
    pub session_id: String,
    pub pid: Option<u32>,
    pub shell: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    terminal_id: String,
    session_id: String,
    #[serde(with = "serde_bytes")]
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    terminal_id: String,
    session_id: String,
    exit_code: u32,
    signal: Option<String>,
}

struct TerminalRuntime {
    session_id: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    process_group: Option<i32>,
    seq: AtomicU64,
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
        if params.shell.trim().is_empty() || params.shell.len() > 4096 {
            bail!("invalid terminal shell");
        }
        if params.args.len() > 64 {
            bail!("too many terminal shell arguments");
        }
        if params.cols < 2 || params.cols > 1000 || params.rows == 0 || params.rows > 500 {
            bail!("invalid terminal dimensions");
        }

        let terminal_id = params
            .terminal_id
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

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: params.rows,
                cols: params.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("open native PTY")?;

        let mut command = CommandBuilder::new(&params.shell);
        command.args(&params.args);
        command.cwd(&params.cwd);
        command.env_clear();
        for (key, value) in filtered_environment() {
            command.env(key, value);
        }
        for (key, value) in &params.env {
            command.env(key, value);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("spawn terminal shell {}", params.shell))?;
        let pid = child.process_id();
        let killer = child.clone_killer();
        let reader = pair.master.try_clone_reader()?;
        let terminal_writer = pair.master.take_writer()?;
        let process_group = {
            #[cfg(unix)]
            {
                pair.master.process_group_leader()
            }
            #[cfg(not(unix))]
            {
                None
            }
        };

        let runtime = Arc::new(TerminalRuntime {
            session_id: params.session_id.clone(),
            master: Mutex::new(pair.master),
            writer: Mutex::new(terminal_writer),
            killer: Mutex::new(killer),
            pid,
            process_group,
            seq: AtomicU64::new(0),
        });

        {
            let mut terminals = self
                .terminals
                .lock()
                .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?;
            terminals.insert(terminal_id.clone(), Arc::clone(&runtime));
        }

        let output_writer = Arc::clone(&self.writer);
        let output_id = terminal_id.clone();
        let output_session = params.session_id.clone();
        let output_runtime = Arc::clone(&runtime);
        thread::spawn(move || {
            stream_output(
                output_writer,
                output_runtime,
                output_id,
                output_session,
                reader,
            );
        });

        let manager = Arc::clone(self);
        let wait_id = terminal_id.clone();
        let wait_session = params.session_id.clone();
        thread::spawn(move || {
            let status = child.wait();
            let current = manager
                .terminals
                .lock()
                .ok()
                .and_then(|mut map| map.remove(&wait_id));
            if current.is_none() {
                return;
            }
            match status {
                Ok(status) => {
                    let event = TerminalExit {
                        terminal_id: wait_id.clone(),
                        session_id: wait_session,
                        exit_code: status.exit_code(),
                        signal: status.signal().map(ToOwned::to_owned),
                    };
                    let _ = manager.writer.send_event(
                        "terminal.exit",
                        Some(&wait_id),
                        None,
                        "normal",
                        &event,
                    );
                }
                Err(error) => {
                    eprintln!("[nd-core] terminal wait failed for {wait_id}: {error}");
                }
            }
        });

        Ok(TerminalCreateResult {
            terminal_id,
            session_id: params.session_id,
            pid,
            shell: params.shell,
        })
    }

    pub fn write(&self, params: TerminalWriteParams) -> Result<()> {
        if params.data.len() > 64 * 1024 {
            bail!("terminal input is too large");
        }
        let runtime = self.runtime(&params.terminal_id)?;
        let mut writer = runtime
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal writer lock poisoned"))?;
        writer.write_all(params.data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, params: TerminalResizeParams) -> Result<()> {
        if params.cols < 2 || params.cols > 1000 || params.rows == 0 || params.rows > 500 {
            bail!("invalid terminal dimensions");
        }
        let runtime = self.runtime(&params.terminal_id)?;
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
        Ok(true)
    }

    pub fn shutdown(&self) {
        let ids = self
            .terminals
            .lock()
            .map(|map| map.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for terminal_id in ids {
            let _ = self.close(TerminalCloseParams { terminal_id });
        }
    }

    pub fn terminal_count(&self) -> usize {
        self.terminals.lock().map(|map| map.len()).unwrap_or_default()
    }

    fn runtime(&self, terminal_id: &str) -> Result<Arc<TerminalRuntime>> {
        validate_id(terminal_id)?;
        self.terminals
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal registry lock poisoned"))?
            .get(terminal_id)
            .map(Arc::clone)
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))
    }
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
                let event = TerminalOutput {
                    terminal_id: terminal_id.clone(),
                    session_id: session_id.clone(),
                    bytes: buffer[..read].to_vec(),
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
