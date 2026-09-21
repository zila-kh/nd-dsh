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

pub fn status(params: GitQueryParams) -> Result<GitStatusResult> {
    let started_at = now_ms();
    let result = exec(GitExecParams {
        cwd: params.cwd,
        args: vec!["status".into(), "-z".into(), "-uall".into()],
        input: None,
        env: params.env,
        max_output_bytes: Some(DEFAULT_MAX_OUTPUT),
        git_path: params.git_path,
    })?;
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

pub fn log(params: GitLogParams) -> Result<GitLogResult> {
    let started_at = now_ms();
    let limit = params.limit.clamp(1, 1000);
    let result = exec(GitExecParams {
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
    })?;
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
        let hash = fields[index]
            .trim_matches(|ch| ch == '\r' || ch == '\n')
            .to_owned();
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
        let message = fields[index + 4]
            .trim_end_matches(|ch| ch == '\r' || ch == '\n')
            .to_owned();
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
        let raw = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0Jane Doe\0jane@example.test\01700000000\0Subject\n\nBody\n\0\n";
        let parsed = parse_log(raw).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].hash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(parsed[0].author_name, "Jane Doe");
        assert_eq!(parsed[0].author_timestamp, 1_700_000_000);
        assert_eq!(parsed[0].message, "Subject\n\nBody");
    }
}
