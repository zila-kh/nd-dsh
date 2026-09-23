use crate::deadline::Interrupt;
use crate::errors::{CODE_INVALID_PARAMS, coded};
use crate::git::{self, GitQueryParams, GitStatusResult};
use crate::revision::{self, Revision, RevisionScope};
use crate::search::{self, SearchParams, SearchResult};
use crate::workspace::{self, ReadParams, ReadResult};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
const MAX_READS: usize = 12;
const MAX_SEARCHES: usize = 4;
const MAX_READ_BYTES: usize = 256 * 1024;
const MAX_RESULTS: usize = 200;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotParams {
    pub root: String,
    #[serde(default)]
    pub reads: Vec<SnapshotRead>,
    #[serde(default)]
    pub searches: Vec<SnapshotSearch>,
    #[serde(default)]
    pub include_git_status: bool,
    pub expected_revision: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRead {
    pub path: String,
    pub max_bytes: Option<usize>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSearch {
    pub query: String,
    pub path: Option<String>,
    pub regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub include_hidden: Option<bool>,
    pub max_results: Option<usize>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub revision: Revision,
    pub stale: bool,
    pub reads: Vec<ReadResult>,
    pub searches: Vec<SearchResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_status: Option<GitStatusResult>,
    pub truncated: bool,
}
pub fn snapshot(p: SnapshotParams, i: &Interrupt) -> Result<SnapshotResult> {
    if p.reads.len() > MAX_READS {
        return Err(coded(
            CODE_INVALID_PARAMS,
            format!("workspace.snapshot accepts at most {MAX_READS} reads"),
        ));
    }
    if p.searches.len() > MAX_SEARCHES {
        return Err(coded(
            CODE_INVALID_PARAMS,
            format!("workspace.snapshot accepts at most {MAX_SEARCHES} searches"),
        ));
    }
    let revision = revision::workspace_revision(&p.root, RevisionScope::Worktree, i)?;
    let stale = p
        .expected_revision
        .as_deref()
        .is_some_and(|x| x != revision.value);
    if stale {
        let truncated = revision.truncated || revision.skipped_entries > 0;
        return Ok(SnapshotResult {
            revision,
            stale: true,
            reads: vec![],
            searches: vec![],
            git_status: None,
            truncated,
        });
    }
    let mut reads = Vec::new();
    for x in p.reads {
        i.check("workspace.snapshot")?;
        reads.push(workspace::read(ReadParams {
            root: p.root.clone(),
            path: x.path,
            max_bytes: Some(
                x.max_bytes
                    .unwrap_or(MAX_READ_BYTES)
                    .clamp(1, MAX_READ_BYTES),
            ),
        })?)
    }
    let mut searches = Vec::new();
    for x in p.searches {
        i.check("workspace.snapshot")?;
        searches.push(search::search(
            SearchParams {
                root: p.root.clone(),
                query: x.query,
                path: x.path.unwrap_or_else(|| ".".to_owned()),
                regex: x.regex,
                case_sensitive: x.case_sensitive,
                include_hidden: x.include_hidden,
                max_results: Some(x.max_results.unwrap_or(MAX_RESULTS).clamp(1, MAX_RESULTS)),
                max_matches_per_file: None,
                max_files: None,
                max_file_bytes: None,
            },
            i,
        )?)
    }
    let git_status = if p.include_git_status {
        Some(git::status(
            GitQueryParams {
                cwd: p.root.clone(),
                env: HashMap::new(),
                git_path: None,
            },
            i,
        )?)
    } else {
        None
    };
    let truncated = revision.truncated
        || revision.skipped_entries > 0
        || reads.iter().any(|x| x.truncated)
        || searches.iter().any(|x| x.truncated)
        || git_status.as_ref().is_some_and(|x| x.truncated);
    Ok(SnapshotResult {
        revision,
        stale: false,
        reads,
        searches,
        git_status,
        truncated,
    })
}
