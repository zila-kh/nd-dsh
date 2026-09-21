mod git;
mod process;
mod protocol;
mod scheduler;
mod terminal;
mod workspace;

use anyhow::{Context, Result};
use process::{CancelParams, ProcessManager, SpawnParams, WriteParams};
use protocol::{PROTOCOL_VERSION, ProtocolWriter, read_request};
use scheduler::{AcquireParams, HeartbeatParams, ReleaseParams, Scheduler};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::io::BufReader;
use std::sync::Arc;
use std::thread;
use terminal::{
    TerminalCloseParams, TerminalCreateParams, TerminalManager, TerminalResizeParams,
    TerminalWriteParams,
};

struct AppState {
    writer: Arc<ProtocolWriter>,
    scheduler: Arc<Scheduler>,
    processes: Arc<ProcessManager>,
    terminals: Arc<TerminalManager>,
}

impl AppState {
    fn new() -> Arc<Self> {
        let writer = Arc::new(ProtocolWriter::new());
        let scheduler = Arc::new(Scheduler::new());
        let processes = Arc::new(ProcessManager::new(
            Arc::clone(&writer),
            Arc::clone(&scheduler),
        ));
        let terminals = Arc::new(TerminalManager::new(Arc::clone(&writer)));
        Arc::new(Self {
            writer,
            scheduler,
            processes,
            terminals,
        })
    }

    fn shutdown(&self) {
        self.terminals.shutdown();
        self.processes.shutdown();
    }
}

fn main() -> Result<()> {
    eprintln!(
        "[nd-core] starting {} protocol v{}",
        env!("CARGO_PKG_VERSION"),
        PROTOCOL_VERSION
    );

    let state = AppState::new();
    let stdin = std::io::stdin();
    let mut input = BufReader::new(stdin.lock());

    loop {
        let request = match read_request(&mut input) {
            Ok(Some(request)) => request,
            Ok(None) => break,
            Err(error) => {
                eprintln!("[nd-core] protocol read failed: {error:#}");
                break;
            }
        };
        let state = Arc::clone(&state);
        thread::spawn(move || {
            let id = request.id.clone();
            match dispatch(Arc::clone(&state), request.method.as_str(), request.params) {
                Ok(result) => {
                    if let Err(error) = state.writer.send_result(&id, &result) {
                        eprintln!("[nd-core] response write failed: {error:#}");
                    }
                }
                Err(error) => {
                    if let Err(write_error) =
                        state
                            .writer
                            .send_error(&id, "method_failed", format!("{error:#}"))
                    {
                        eprintln!("[nd-core] error response write failed: {write_error:#}");
                    }
                }
            }
        });
    }

    state.shutdown();
    eprintln!("[nd-core] stopped");
    Ok(())
}

fn dispatch(state: Arc<AppState>, method: &str, params: Value) -> Result<Value> {
    match method {
        "core.health" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "binaryVersion": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "capabilities": [
                "scheduler",
                "process",
                "terminal",
                "git",
                "workspace",
                "metrics"
            ],
            "processCount": state.processes.process_count(),
            "terminalCount": state.terminals.terminal_count(),
        })),
        "scheduler.acquire" => to_value(state.scheduler.acquire(from_params(params)?)?),
        "scheduler.heartbeat" => to_value(state.scheduler.heartbeat(from_params(params)?)?),
        "scheduler.release" => {
            let released = state
                .scheduler
                .release(from_params::<ReleaseParams>(params)?)?;
            Ok(json!({ "released": released }))
        }
        "scheduler.snapshot" => to_value(state.scheduler.snapshot()?),
        "process.spawn" => to_value(state.processes.spawn(from_params::<SpawnParams>(params)?)?),
        "process.write" => {
            state.processes.write(from_params::<WriteParams>(params)?)?;
            Ok(json!({ "ok": true }))
        }
        "process.cancel" => {
            let canceled = state
                .processes
                .cancel(from_params::<CancelParams>(params)?)?;
            Ok(json!({ "canceled": canceled }))
        }
        "process.snapshot" => to_value(state.processes.snapshot()?),
        "terminal.create" => to_value(
            state
                .terminals
                .create(from_params::<TerminalCreateParams>(params)?)?,
        ),
        "terminal.write" => {
            state
                .terminals
                .write(from_params::<TerminalWriteParams>(params)?)?;
            Ok(json!({ "ok": true }))
        }
        "terminal.resize" => {
            state
                .terminals
                .resize(from_params::<TerminalResizeParams>(params)?)?;
            Ok(json!({ "ok": true }))
        }
        "terminal.close" => {
            let closed = state
                .terminals
                .close(from_params::<TerminalCloseParams>(params)?)?;
            Ok(json!({ "closed": closed }))
        }
        "git.exec" => to_value(git::exec(from_params(params)?)?),
        "workspace.realpath" => to_value(workspace::realpath(from_params(params)?)?),
        "workspace.stat" => to_value(workspace::stat(from_params(params)?)?),
        "workspace.read" => to_value(workspace::read(from_params(params)?)?),
        "workspace.list" => to_value(workspace::list(from_params(params)?)?),
        "workspace.atomicWrite" => to_value(workspace::atomic_write(from_params(params)?)?),
        _ => anyhow::bail!("unknown nd-core method: {method}"),
    }
}

fn from_params<T: DeserializeOwned>(params: Value) -> Result<T> {
    serde_json::from_value(params).context("decode method parameters")
}

fn to_value<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).context("encode method result")
}
