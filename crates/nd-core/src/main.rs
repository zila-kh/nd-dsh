mod dispatcher;
mod git;
mod metrics;
mod process;
mod protocol;
mod scheduler;
mod terminal;
mod workspace;

use anyhow::{Context, Result};
use dispatcher::{DispatchStats, Dispatcher, priority_for_method};
use metrics::MetricsRegistry;
use process::{CancelParams, CloseStdinParams, ProcessManager, SpawnParams, WriteParams};
use protocol::{PROTOCOL_VERSION, ProtocolWriter, read_request};
use scheduler::{BindParams, ReleaseParams, Scheduler};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::io::BufReader;
use std::sync::Arc;
use terminal::{
    TerminalCloseParams, TerminalCreateParams, TerminalManager, TerminalResizeParams,
    TerminalWriteParams,
};

struct AppState {
    writer: Arc<ProtocolWriter>,
    scheduler: Arc<Scheduler>,
    processes: Arc<ProcessManager>,
    terminals: Arc<TerminalManager>,
    metrics: Arc<MetricsRegistry>,
    dispatch_stats: DispatchStats,
}

impl AppState {
    fn new(dispatch_stats: DispatchStats) -> Arc<Self> {
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
            metrics: Arc::new(MetricsRegistry::new()),
            dispatch_stats,
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

    let dispatcher = Dispatcher::new();
    let state = AppState::new(dispatcher.stats());
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
        let id = request.id.clone();
        let rejection_id = id.clone();
        let method = request.method.clone();
        let priority = priority_for_method(&method);
        let state_for_job = Arc::clone(&state);
        let writer = Arc::clone(&state.writer);
        if let Err(error) = dispatcher.submit(priority, move || {
            match dispatch(state_for_job.clone(), method.as_str(), request.params) {
                Ok(result) => {
                    if let Err(error) = state_for_job.writer.send_result(&id, &result) {
                        eprintln!("[nd-core] response write failed: {error:#}");
                    }
                }
                Err(error) => {
                    if let Err(write_error) =
                        state_for_job
                            .writer
                            .send_error(&id, "method_failed", format!("{error:#}"))
                    {
                        eprintln!("[nd-core] error response write failed: {write_error:#}");
                    }
                }
            }
        }) {
            let _ = writer.send_error(&rejection_id, "runtime_busy", format!("{error:#}"));
        }
    }

    dispatcher.shutdown();
    state.shutdown();
    eprintln!("[nd-core] stopped");
    Ok(())
}
fn dispatch(state: Arc<AppState>, method: &str, params: Value) -> Result<Value> {
    match method {
        "core.health" => {
            let dispatch = state.dispatch_stats.snapshot();
            Ok(json!({
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
                "workspaceCount": state.metrics.workspace_count(),
                "pendingRpcCount": dispatch.active + dispatch.queued_high + dispatch.queued_normal + dispatch.queued_background,
            }))
        }
        "metrics.snapshot" => {
            let scheduler = state.scheduler.snapshot()?;
            let dispatch = state.dispatch_stats.snapshot();
            let outbound = state.writer.snapshot();
            let queued_event_count = outbound.queued_frames;
            let queued_event_bytes = outbound.queued_bytes;
            let bound_sessions = scheduler
                .permits
                .iter()
                .filter(|permit| permit.session_id.is_some())
                .count();
            Ok(json!({
                "processMemory": metrics::current_process_memory(),
                "logicalSessionCount": scheduler.permits.len(),
                "boundSessionCount": bound_sessions,
                "workspaceCount": state.metrics.workspace_count(),
                "processCount": state.processes.process_count(),
                "terminalCount": state.terminals.terminal_count(),
                "retainedTerminalBufferBytes": 0,
                "pendingRpcCount": dispatch.active + dispatch.queued_high + dispatch.queued_normal + dispatch.queued_background,
                "dispatcher": dispatch,
                "outbound": outbound,
                "queuedEventCount": queued_event_count,
                "queuedEventBytes": queued_event_bytes,
            }))
        }
        "scheduler.acquire" => to_value(state.scheduler.acquire(from_params(params)?)?),
        "scheduler.bind" => to_value(state.scheduler.bind(from_params::<BindParams>(params)?)?),
        "scheduler.heartbeat" => to_value(state.scheduler.heartbeat(from_params(params)?)?),
        "scheduler.release" => {
            let params = from_params::<ReleaseParams>(params)?;
            state.processes.cancel_permit(&params.permit_id);
            let released = state.scheduler.release(params)?;
            Ok(json!({ "released": released }))
        }
        "scheduler.snapshot" => to_value(state.scheduler.snapshot()?),
        "process.spawn" => {
            let params = from_params::<SpawnParams>(params)?;
            if let Some(cwd) = params.cwd.as_deref() {
                state.metrics.observe_workspace(cwd);
            }
            to_value(state.processes.spawn(params)?)
        }
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
        "process.closeStdin" => {
            let closed = state
                .processes
                .close_stdin(from_params::<CloseStdinParams>(params)?)?;
            Ok(json!({ "closed": closed }))
        }
        "process.snapshot" => to_value(state.processes.snapshot()?),
        "terminal.create" => {
            let params = from_params::<TerminalCreateParams>(params)?;
            state.metrics.observe_workspace(&params.cwd);
            to_value(state.terminals.create(params)?)
        }
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
        "git.exec" => {
            let params = from_params::<git::GitExecParams>(params)?;
            state.metrics.observe_workspace(&params.cwd);
            to_value(git::exec(params)?)
        }
        "workspace.realpath" => {
            let params = from_params::<workspace::PathParams>(params)?;
            state.metrics.observe_workspace(&params.root);
            to_value(workspace::realpath(params)?)
        }
        "workspace.stat" => {
            let params = from_params::<workspace::PathParams>(params)?;
            state.metrics.observe_workspace(&params.root);
            to_value(workspace::stat(params)?)
        }
        "workspace.read" => {
            let params = from_params::<workspace::ReadParams>(params)?;
            state.metrics.observe_workspace(&params.root);
            to_value(workspace::read(params)?)
        }
        "workspace.list" => {
            let params = from_params::<workspace::PathParams>(params)?;
            state.metrics.observe_workspace(&params.root);
            to_value(workspace::list(params)?)
        }
        "workspace.atomicWrite" => {
            let params = from_params::<workspace::AtomicWriteParams>(params)?;
            state.metrics.observe_workspace(&params.root);
            to_value(workspace::atomic_write(params)?)
        }
        _ => anyhow::bail!("unknown nd-core method: {method}"),
    }
}

fn from_params<T: DeserializeOwned>(params: Value) -> Result<T> {
    serde_json::from_value(params).context("decode method parameters")
}

fn to_value<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).context("encode method result")
}
