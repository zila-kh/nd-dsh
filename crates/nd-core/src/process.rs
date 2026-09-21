use crate::protocol::ProtocolWriter;
use crate::scheduler::{Scheduler, now_ms};
#[cfg(windows)]
use crate::windows_job::WindowsJob;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnParams {
    pub id: Option<String>,
    pub permit_id: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub inherit_env: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteParams {
    pub process_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelParams {
    pub process_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseStdinParams {
    pub process_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub process_id: String,
    pub pid: u32,
    pub started_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSnapshot {
    pub process_id: String,
    pub pid: u32,
    pub permit_id: Option<String>,
    pub started_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessOutput {
    process_id: String,
    stream: &'static str,
    #[serde(with = "serde_bytes")]
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessExit {
    process_id: String,
    pid: u32,
    exit_code: i32,
    duration_ms: u64,
}

struct ManagedProcess {
    pid: u32,
    child: Arc<Mutex<Child>>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    permit_id: Option<String>,
    started_at: u64,
    #[cfg(windows)]
    _job: WindowsJob,
}

pub struct ProcessManager {
    writer: Arc<ProtocolWriter>,
    scheduler: Arc<Scheduler>,
    processes: Mutex<HashMap<String, ManagedProcess>>,
}

impl ProcessManager {
    pub fn new(writer: Arc<ProtocolWriter>, scheduler: Arc<Scheduler>) -> Self {
        Self {
            writer,
            scheduler,
            processes: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(self: &Arc<Self>, params: SpawnParams) -> Result<SpawnResult> {
        if params.command.trim().is_empty() || params.command.len() > 4096 {
            bail!("invalid process command");
        }
        if params.args.len() > 512 || params.args.iter().any(|arg| arg.len() > 64 * 1024) {
            bail!("invalid process arguments");
        }
        if let Some(permit_id) = params.permit_id.as_deref()
            && !self.scheduler.has_permit(permit_id)
        {
            bail!("runtime permit is missing or expired");
        }

        let id = params.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        if id.is_empty() || id.len() > 256 {
            bail!("invalid process id");
        }
        {
            let processes = self
                .processes
                .lock()
                .map_err(|_| anyhow::anyhow!("process registry lock poisoned"))?;
            if processes.contains_key(&id) {
                bail!("process id already exists");
            }
        }

        let mut command = Command::new(&params.command);
        command.args(&params.args);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        if let Some(cwd) = params.cwd.as_deref() {
            command.current_dir(cwd);
        }

        command.env_clear();
        if params.inherit_env.unwrap_or(true) {
            for (key, value) in filtered_environment() {
                command.env(key, value);
            }
        }
        for (key, value) in params.env {
            if key.len() > 256 || value.len() > 64 * 1024 {
                bail!("invalid process environment");
            }
            // Explicit env comes from the owning TypeScript engine adapter.
            // ND safeStorage credentials are never inserted here implicitly;
            // user/CLI-owned auth variables may be intentionally forwarded.
            command.env(key, value);
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            command.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("spawn {}", params.command))?;
        #[cfg(windows)]
        let job = {
            use std::os::windows::io::AsRawHandle;
            match WindowsJob::assign(child.as_raw_handle()) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    return Err(error).context("attach managed process to kill-on-close job");
                }
            }
        };
        let pid = child.id();
        let stdin = child.stdin.take().map(|input| Arc::new(Mutex::new(input)));
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let started_at = now_ms();

        {
            let mut processes = self
                .processes
                .lock()
                .map_err(|_| anyhow::anyhow!("process registry lock poisoned"))?;
            processes.insert(
                id.clone(),
                ManagedProcess {
                    pid,
                    child: Arc::clone(&child),
                    stdin,
                    permit_id: params.permit_id,
                    started_at,
                    #[cfg(windows)]
                    _job: job,
                },
            );
        }

        if let Some(stdout) = stdout {
            spawn_reader(Arc::clone(&self.writer), id.clone(), "stdout", stdout);
        }
        if let Some(stderr) = stderr {
            spawn_reader(Arc::clone(&self.writer), id.clone(), "stderr", stderr);
        }

        let manager = Arc::clone(self);
        let wait_id = id.clone();
        thread::spawn(move || {
            loop {
                let status = {
                    let Ok(mut child) = child.lock() else {
                        return;
                    };
                    match child.try_wait() {
                        Ok(status) => status,
                        Err(error) => {
                            eprintln!("[nd-core] process wait failed for {wait_id}: {error}");
                            None
                        }
                    }
                };
                if let Some(status) = status {
                    let record = {
                        let Ok(mut processes) = manager.processes.lock() else {
                            return;
                        };
                        processes.remove(&wait_id)
                    };
                    if let Some(record) = record {
                        let event = ProcessExit {
                            process_id: wait_id.clone(),
                            pid: record.pid,
                            exit_code: status.code().unwrap_or(-1),
                            duration_ms: now_ms().saturating_sub(record.started_at),
                        };
                        let _ = manager.writer.send_event(
                            "process.exit",
                            Some(&wait_id),
                            None,
                            "normal",
                            &event,
                        );
                    }
                    break;
                }

                let expired_permit = manager
                    .processes
                    .lock()
                    .ok()
                    .and_then(|processes| {
                        processes
                            .get(&wait_id)
                            .and_then(|record| record.permit_id.clone())
                    })
                    .is_some_and(|permit_id| !manager.scheduler.has_permit(&permit_id));
                if expired_permit {
                    let _ = manager.cancel(CancelParams {
                        process_id: wait_id.clone(),
                    });
                }
                thread::sleep(Duration::from_millis(25));
            }
        });

        Ok(SpawnResult {
            process_id: id,
            pid,
            started_at,
        })
    }

    pub fn write(&self, params: WriteParams) -> Result<()> {
        if params.data.len() > 64 * 1024 {
            bail!("process stdin chunk is too large");
        }
        let stdin = {
            let processes = self
                .processes
                .lock()
                .map_err(|_| anyhow::anyhow!("process registry lock poisoned"))?;
            processes
                .get(&params.process_id)
                .and_then(|record| record.stdin.as_ref().map(Arc::clone))
                .ok_or_else(|| anyhow::anyhow!("process stdin is unavailable"))?
        };
        let mut stdin = stdin
            .lock()
            .map_err(|_| anyhow::anyhow!("process stdin lock poisoned"))?;
        stdin.write_all(params.data.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }

    pub fn cancel(&self, params: CancelParams) -> Result<bool> {
        let (pid, child) = {
            let processes = self
                .processes
                .lock()
                .map_err(|_| anyhow::anyhow!("process registry lock poisoned"))?;
            let Some(record) = processes.get(&params.process_id) else {
                return Ok(false);
            };
            (record.pid, Arc::clone(&record.child))
        };

        kill_process_tree(pid);
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
        Ok(true)
    }

    pub fn close_stdin(&self, params: CloseStdinParams) -> Result<bool> {
        let stdin = {
            let mut processes = self
                .processes
                .lock()
                .map_err(|_| anyhow::anyhow!("process registry lock poisoned"))?;
            let Some(record) = processes.get_mut(&params.process_id) else {
                return Ok(false);
            };
            record.stdin.take()
        };
        Ok(stdin.is_some())
    }

    pub fn cancel_permit(&self, permit_id: &str) -> usize {
        let ids = self
            .processes
            .lock()
            .map(|processes| {
                processes
                    .iter()
                    .filter(|(_, record)| record.permit_id.as_deref() == Some(permit_id))
                    .map(|(id, _)| id.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for process_id in &ids {
            let _ = self.cancel(CancelParams {
                process_id: process_id.clone(),
            });
        }
        ids.len()
    }

    pub fn snapshot(&self) -> Result<Vec<ProcessSnapshot>> {
        let processes = self
            .processes
            .lock()
            .map_err(|_| anyhow::anyhow!("process registry lock poisoned"))?;
        let mut result = processes
            .iter()
            .map(|(id, record)| ProcessSnapshot {
                process_id: id.clone(),
                pid: record.pid,
                permit_id: record.permit_id.clone(),
                started_at: record.started_at,
            })
            .collect::<Vec<_>>();
        result.sort_by_key(|item| item.started_at);
        Ok(result)
    }

    pub fn shutdown(&self) {
        let ids = self
            .processes
            .lock()
            .map(|processes| processes.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for process_id in ids {
            let _ = self.cancel(CancelParams { process_id });
        }
    }

    pub fn process_count(&self) -> usize {
        self.processes
            .lock()
            .map(|map| map.len())
            .unwrap_or_default()
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    writer: Arc<ProtocolWriter>,
    process_id: String,
    stream: &'static str,
    mut reader: R,
) {
    thread::spawn(move || {
        let mut buffer = vec![0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let event = ProcessOutput {
                        process_id: process_id.clone(),
                        stream,
                        bytes: buffer[..read].to_vec(),
                    };
                    if writer
                        .send_event("process.output", Some(&process_id), None, "normal", &event)
                        .is_err()
                    {
                        break;
                    }
                }
                Err(error) => {
                    eprintln!("[nd-core] process {stream} read failed for {process_id}: {error}");
                    break;
                }
            }
        }
    });
}

pub fn filtered_environment() -> impl Iterator<Item = (String, String)> {
    std::env::vars().filter(|(key, _)| !looks_secret(key))
}

fn looks_secret(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    [
        "API_KEY",
        "ACCESS_KEY",
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "AUTHORIZATION",
        "PRIVATE_KEY",
    ]
    .iter()
    .any(|needle| upper.contains(needle))
}

pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .and_then(|mut child| child.wait());
    }

    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_environment_names_are_filtered() {
        assert!(looks_secret("OPENAI_API_KEY"));
        assert!(looks_secret("AUTHORIZATION"));
        assert!(looks_secret("my_private_key"));
        assert!(!looks_secret("PATH"));
        assert!(!looks_secret("TERM"));
    }
}
