use crate::cache::{self, ResponseCache};
use crate::deadline::Interrupt;
use crate::errors::coded;
use crate::process::{filtered_environment, kill_process_tree};
use crate::revision::RevisionScope;
use crate::scheduler::now_ms;
#[cfg(windows)]
use crate::windows_job::WindowsJob;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::thread::{self, JoinHandle};

const DEFAULT_MAX_OUTPUT: usize = 24 * 1024 * 1024;

/// Held for the lifetime of one Git request. On Windows that is the Job Object whose
/// close ends the tree; elsewhere the process group set at spawn is enough.
#[cfg(windows)]
type JobHandle = Option<WindowsJob>;
#[cfg(not(windows))]
type JobHandle = ();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitExecParams {
    pub cwd: String,
    pub args: Vec<String>,
    pub input: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub max_output_bytes: Option<usize>,
    pub git_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitQueryParams {
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub git_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogParams {
    pub cwd: String,
    pub limit: usize,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub git_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub x: String,
    pub y: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rename: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub exit_code: i32,
    pub stderr: String,
    pub duration_ms: u64,
    pub truncated: bool,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub hash: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_timestamp: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResult {
    pub exit_code: i32,
    pub stderr: String,
    pub duration_ms: u64,
    pub truncated: bool,
    pub commits: Vec<GitLogEntry>,
}

/// `git status` reports on the working tree and the index, so its cache marker is the
/// worktree fingerprint; `git log` depends only on refs, so its marker is the much
/// cheaper Git-metadata one.
pub fn cached_status(
    params: GitQueryParams,
    interrupt: &Interrupt,
    cache: &ResponseCache,
) -> Result<Value> {
    let cwd = params.cwd.clone();
    let revision = crate::revision::workspace_revision(&cwd, RevisionScope::Worktree, interrupt)?;
    let key = format!("git.status:{cwd}");
    if revision.safe_for_cache()
        && let Some(hit) = cache.get(&key, &revision.value)
    {
        return Ok(hit);
    }
    let result = status(params, interrupt)?;
    let mut value = serde_json::to_value(&result).context("encode git.status result")?;
    cache::annotate(&mut value, &revision.value, false);
    if revision.safe_for_cache() {
        cache.put(&key, &revision.value, &value);
    }
    Ok(value)
}

pub fn cached_log(
    params: GitLogParams,
    interrupt: &Interrupt,
    cache: &ResponseCache,
) -> Result<Value> {
    let cwd = params.cwd.clone();
    let revision = crate::revision::workspace_revision(&cwd, RevisionScope::GitRefs, interrupt)?;
    let key = format!("git.log:{cwd}:{}", params.limit);
    if revision.safe_for_cache()
        && let Some(hit) = cache.get(&key, &revision.value)
    {
        return Ok(hit);
    }
    let result = log(params, interrupt)?;
    let mut value = serde_json::to_value(&result).context("encode git.log result")?;
    cache::annotate(&mut value, &revision.value, false);
    if revision.safe_for_cache() {
        cache.put(&key, &revision.value, &value);
    }
    Ok(value)
}

pub fn status(params: GitQueryParams, interrupt: &Interrupt) -> Result<GitStatusResult> {
    let started_at = now_ms();
    let result = exec(
        GitExecParams {
            cwd: params.cwd,
            args: vec!["status".into(), "-z".into(), "-uall".into()],
            input: None,
            env: params.env,
            max_output_bytes: Some(DEFAULT_MAX_OUTPUT),
            git_path: params.git_path,
        },
        interrupt,
    )?;
    let entries = if result.exit_code == 0 && !result.truncated {
        parse_status(&result.stdout)?
    } else {
        Vec::new()
    };
    Ok(GitStatusResult {
        exit_code: result.exit_code,
        stderr: result.stderr,
        duration_ms: now_ms().saturating_sub(started_at),
        truncated: result.truncated,
        entries,
    })
}

pub fn log(params: GitLogParams, interrupt: &Interrupt) -> Result<GitLogResult> {
    let started_at = now_ms();
    let limit = params.limit.clamp(1, 1000);
    let result = exec(
        GitExecParams {
            cwd: params.cwd,
            args: vec![
                "log".into(),
                format!("-n{limit}"),
                "--format=%H%x00%aN%x00%aE%x00%at%x00%B%x00".into(),
            ],
            input: None,
            env: params.env,
            max_output_bytes: Some(DEFAULT_MAX_OUTPUT),
            git_path: params.git_path,
        },
        interrupt,
    )?;
    let commits = if result.exit_code == 0 && !result.truncated {
        parse_log(&result.stdout)?
    } else {
        Vec::new()
    };
    Ok(GitLogResult {
        exit_code: result.exit_code,
        stderr: result.stderr,
        duration_ms: now_ms().saturating_sub(started_at),
        truncated: result.truncated,
        commits,
    })
}

fn parse_status(raw: &str) -> Result<Vec<GitStatusEntry>> {
    let fields = raw.split('\0').collect::<Vec<_>>();
    let mut entries = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let field = fields[index];
        if field.is_empty() {
            index += 1;
            continue;
        }
        if field.len() < 3 || field.as_bytes()[2] != b' ' {
            bail!("malformed Git porcelain status entry");
        }
        let x = field[0..1].to_owned();
        let y = field[1..2].to_owned();
        let first_path = field[3..].to_owned();
        let renamed = x == "R" || y == "R" || x == "C";
        let (path, rename) = if renamed {
            let original = fields
                .get(index + 1)
                .ok_or_else(|| anyhow::anyhow!("malformed Git rename status entry"))?
                .to_string();
            index += 1;
            (original, Some(first_path))
        } else {
            (first_path, None)
        };
        if !path.ends_with('/') {
            entries.push(GitStatusEntry { x, y, path, rename });
        }
        index += 1;
    }
    Ok(entries)
}

fn parse_log(raw: &str) -> Result<Vec<GitLogEntry>> {
    let fields = raw.split('\0').collect::<Vec<_>>();
    let mut commits = Vec::new();
    let mut index = 0;
    while index + 4 < fields.len() {
        let hash = fields[index].trim_matches(['\r', '\n']).to_owned();
        if hash.is_empty() {
            index += 1;
            continue;
        }
        if !(hash.len() == 40 || hash.len() == 64)
            || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            bail!("malformed Git log hash");
        }
        let author_name = fields[index + 1].to_owned();
        let author_email = fields[index + 2].to_owned();
        let author_timestamp = fields[index + 3]
            .trim()
            .parse::<i64>()
            .context("parse Git author timestamp")?;
        let message = fields[index + 4].trim_end_matches(['\r', '\n']).to_owned();
        commits.push(GitLogEntry {
            hash,
            message,
            author_name,
            author_email,
            author_timestamp,
        });
        index += 5;
    }
    Ok(commits)
}

pub fn exec(params: GitExecParams, interrupt: &Interrupt) -> Result<GitExecResult> {
    interrupt.check("git.exec")?;
    if params.cwd.trim().is_empty() || params.cwd.len() > 4096 {
        bail!("invalid Git cwd");
    }
    if params.args.is_empty()
        || params.args.len() > 512
        || params.args.iter().any(|arg| arg.len() > 64 * 1024)
    {
        bail!("invalid Git arguments");
    }

    let git = params
        .git_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("git");
    let max_output = params
        .max_output_bytes
        .unwrap_or(DEFAULT_MAX_OUTPUT)
        .clamp(64 * 1024, 64 * 1024 * 1024);
    let started_at = now_ms();

    let mut command = Command::new(git);
    command
        .args(&params.args)
        .current_dir(&params.cwd)
        .stdin(if params.input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();

    for (key, value) in filtered_environment() {
        command.env(key, value);
    }
    command
        .env("LANGUAGE", "en")
        .env("LC_ALL", "C.UTF-8")
        .env("LANG", "C.UTF-8")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "echo")
        .env("SSH_ASKPASS", "echo");
    for (key, value) in params.env {
        command.env(key, value);
    }

    // Own process group/job so an interrupt can end the whole Git tree, not just the
    // process this request spawned.
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
        .with_context(|| format!("spawn git command {}", params.args.join(" ")))?;
    #[cfg(windows)]
    // Held for the lifetime of the request: closing it kills anything still in the
    // tree, which is what makes an interrupted Git command leave no descendants.
    let mut job = {
        use std::os::windows::io::AsRawHandle;
        match WindowsJob::assign(child.as_raw_handle()) {
            Ok(job) => Some(job),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error).context("attach Git child to kill-on-close job");
            }
        }
    };
    #[cfg(not(windows))]
    let mut job = ();

    if let Some(input) = params.input {
        if input.len() > max_output {
            let _ = child.kill();
            let _ = child.wait();
            bail!("Git input exceeds configured bound");
        }
        if let Some(mut stdin) = child.stdin.take() {
            let write_result = stdin.write_all(input.as_bytes());
            drop(stdin);
            if let Err(error) = write_result {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error).context("write Git stdin");
            }
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("Git stdout pipe is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("Git stderr pipe is unavailable"))?;
    let stdout_reader = spawn_bounded_reader(stdout, max_output);
    let stderr_reader = spawn_bounded_reader(stderr, max_output);

    // The child is owned by this thread, which is what keeps the interrupt honest: a
    // stop kills the tree this thread is waiting on, and no other thread ever holds a
    // pid it could reuse after the child is reaped.
    let stopped = loop {
        if let Some(stop_reason) = interrupt.stop_reason() {
            end_git_tree(&mut child, &mut job);
            break Some(stop_reason);
        }
        match child.try_wait()? {
            Some(_) => break None,
            None => thread::sleep(interrupt.poll_slice()),
        }
    };

    let status = child.wait()?;
    let (stdout_bytes, stdout_truncated) = join_reader(stdout_reader, "stdout")?;
    let (stderr_bytes, stderr_truncated) = join_reader(stderr_reader, "stderr")?;

    if let Some(stop_reason) = stopped {
        return Err(coded(
            stop_reason.code(),
            format!(
                "git command was stopped before it finished: {}",
                params.args.join(" ")
            ),
        ));
    }

    Ok(GitExecResult {
        exit_code: status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        duration_ms: now_ms().saturating_sub(started_at),
        truncated: stdout_truncated || stderr_truncated,
    })
}

/// End the Git tree this request owns and reap the child, so a stopped request
/// leaves neither a process nor a zombie behind.
fn end_git_tree(child: &mut Child, job: &mut JobHandle) {
    kill_process_tree(child.id());
    let _ = child.kill();
    #[cfg(windows)]
    drop(job.take());
    #[cfg(not(windows))]
    let _ = job;
    let _ = child.wait();
}

fn spawn_bounded_reader<R: Read + Send + 'static>(
    mut reader: R,
    max: usize,
) -> JoinHandle<Result<(Vec<u8>, bool)>> {
    thread::spawn(move || {
        let mut kept = Vec::with_capacity(max.min(64 * 1024));
        let mut buffer = [0u8; 16 * 1024];
        let mut truncated = false;
        loop {
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            let remaining = max.saturating_sub(kept.len());
            if remaining > 0 {
                let take = remaining.min(read);
                kept.extend_from_slice(&buffer[..take]);
            }
            if read > remaining {
                truncated = true;
            }
        }
        Ok((kept, truncated))
    })
}

fn join_reader(
    handle: JoinHandle<Result<(Vec<u8>, bool)>>,
    stream: &str,
) -> Result<(Vec<u8>, bool)> {
    handle
        .join()
        .map_err(|_| anyhow::anyhow!("Git {stream} reader thread panicked"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_status_including_rename_order() {
        let parsed =
            parse_status("M  src/app.ts\0R  src/new.ts\0src/old.ts\0?? new.txt\0").unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].path, "src/app.ts");
        assert_eq!(parsed[1].path, "src/old.ts");
        assert_eq!(parsed[1].rename.as_deref(), Some("src/new.ts"));
        assert_eq!(parsed[2].x, "?");
        assert_eq!(parsed[2].y, "?");
    }

    #[test]
    fn parses_nul_delimited_log_without_regex_scanning() {
        let raw = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0Jane Doe\0jane@example.test\x001700000000\0Subject\n\nBody\n\0\n";
        let parsed = parse_log(raw).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].hash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(parsed[0].author_name, "Jane Doe");
        assert_eq!(parsed[0].author_timestamp, 1_700_000_000);
        assert_eq!(parsed[0].message, "Subject\n\nBody");
    }
}
