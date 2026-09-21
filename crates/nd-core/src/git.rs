use crate::process::filtered_environment;
use crate::scheduler::now_ms;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};

const DEFAULT_MAX_OUTPUT: usize = 24 * 1024 * 1024;

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

pub fn exec(params: GitExecParams) -> Result<GitExecResult> {
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

    let mut child = command
        .spawn()
        .with_context(|| format!("spawn git command {}", params.args.join(" ")))?;
    if let Some(input) = params.input {
        if input.len() > max_output {
            bail!("Git input exceeds configured bound");
        }
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(input.as_bytes())?;
        }
    }

    let output = child.wait_with_output()?;
    let (stdout, stdout_truncated) = bounded_text(&output.stdout, max_output);
    let (stderr, stderr_truncated) = bounded_text(&output.stderr, max_output);

    Ok(GitExecResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout,
        stderr,
        duration_ms: now_ms().saturating_sub(started_at),
        truncated: stdout_truncated || stderr_truncated,
    })
}

fn bounded_text(bytes: &[u8], max: usize) -> (String, bool) {
    let truncated = bytes.len() > max;
    let slice = if truncated { &bytes[..max] } else { bytes };
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}
