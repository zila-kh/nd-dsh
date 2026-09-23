//! Bounded workspace content search.
//!
//! Search is the operation an agent repeats most per task, and an agent that cannot
//! search efficiently compensates with extra model calls. This module answers one
//! query per request with hard bounds on every axis, and it always says which bound
//! it hit, so a caller can tell a complete result from a capped one.
//!
//! The scan runs on the requesting dispatcher thread and never spawns a worker. That
//! is a deliberate choice: it makes "no orphaned scanner left running" a structural
//! property rather than a cleanup obligation, so a deadline or a cancel can only stop
//! the walk, never leave it behind. The same choice is why the walk uses `ignore`'s
//! single-threaded builder rather than its parallel one.

use crate::deadline::Interrupt;
use crate::errors::{CODE_INVALID_PARAMS, coded};
use crate::workspace::{canonical_root, resolve_existing_from_root};
use anyhow::{Result, bail};
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const MAX_QUERY_LENGTH: usize = 4096;
const DEFAULT_MAX_RESULTS: usize = 200;
const HARD_MAX_RESULTS: usize = 5_000;
const DEFAULT_MAX_MATCHES_PER_FILE: usize = 50;
const HARD_MAX_MATCHES_PER_FILE: usize = 1_000;
const DEFAULT_MAX_FILES: usize = 20_000;
const HARD_MAX_FILES: usize = 200_000;
const DEFAULT_MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const HARD_MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
/// Longest preview kept per match, so one pathological line cannot dominate a
/// response that is otherwise bounded by match count.
const MAX_PREVIEW_CHARS: usize = 400;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    pub root: String,
    pub query: String,
    #[serde(default = "default_relative")]
    pub path: String,
    /// Treat `query` as a regular expression instead of a literal string.
    pub regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    /// Include dotfiles and dot-directories. Off by default, matching the
    /// convention of every other code-search tool.
    pub include_hidden: Option<bool>,
    pub max_results: Option<usize>,
    pub max_matches_per_file: Option<usize>,
    pub max_files: Option<usize>,
    pub max_file_bytes: Option<usize>,
}

fn default_relative() -> String {
    ".".to_owned()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
    pub preview_truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub root: String,
    pub path: String,
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub include_hidden: bool,
    pub matches: Vec<SearchMatch>,
    /// At least one bound was hit, so this is not a complete view of the tree.
    /// `stopReason` names a terminal cause; `cappedFiles` covers per-file capping.
    pub truncated: bool,
    /// Why the scan stopped early. Absent when the whole tree was scanned.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<&'static str>,
    /// Files that had more matches than the per-file bound allowed.
    pub capped_files: usize,
    pub scanned_files: usize,
    pub skipped_binary_files: usize,
    pub skipped_oversized_files: usize,
    pub unreadable_files: usize,
    pub limits: SearchLimits,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLimits {
    pub max_results: usize,
    pub max_matches_per_file: usize,
    pub max_files: usize,
    pub max_file_bytes: usize,
}

/// Why a scan stopped early. Every value except a completed scan is surfaced to the
/// caller as `stopReason` alongside `truncated: true`.
const STOP_RESULT_LIMIT: &str = "resultLimit";
const STOP_FILE_LIMIT: &str = "fileLimit";
const STOP_DEADLINE: &str = "deadlineExceeded";
const STOP_CANCELED: &str = "canceled";

pub fn search(params: SearchParams, interrupt: &Interrupt) -> Result<SearchResult> {
    let started_at = crate::scheduler::now_ms();
    let root = canonical_root(&params.root)?;
    let scope = resolve_existing_from_root(&root, &params.path)?;
    let query = params.query.trim();
    if query.is_empty() {
        bail!("search query is empty");
    }
    if query.len() > MAX_QUERY_LENGTH {
        bail!("search query is too long");
    }

    let limits = SearchLimits {
        max_results: params
            .max_results
            .unwrap_or(DEFAULT_MAX_RESULTS)
            .clamp(1, HARD_MAX_RESULTS),
        max_matches_per_file: params
            .max_matches_per_file
            .unwrap_or(DEFAULT_MAX_MATCHES_PER_FILE)
            .clamp(1, HARD_MAX_MATCHES_PER_FILE),
        max_files: params
            .max_files
            .unwrap_or(DEFAULT_MAX_FILES)
            .clamp(1, HARD_MAX_FILES),
        max_file_bytes: params
            .max_file_bytes
            .unwrap_or(DEFAULT_MAX_FILE_BYTES)
            .clamp(1, HARD_MAX_FILE_BYTES),
    };

    let case_sensitive = params
        .case_sensitive
        .unwrap_or_else(|| query_needs_case(query));
    let include_hidden = params.include_hidden.unwrap_or(false);
    let matcher = build_matcher(query, params.regex.unwrap_or(false), case_sensitive)?;

    let mut matches = Vec::new();
    let mut stop_reason: Option<&'static str> = None;
    let mut capped_files = 0usize;
    let mut scanned_files = 0usize;
    let mut skipped_binary_files = 0usize;
    let mut skipped_oversized_files = 0usize;
    let mut unreadable_files = 0usize;

    let walker = WalkBuilder::new(&scope)
        .hidden(!include_hidden)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .parents(false)
        .follow_links(false)
        .sort_by_file_name(|left, right| left.cmp(right))
        .build();

    'walk: for entry in walker {
        if let Some(reason) = interrupt_reason(interrupt) {
            stop_reason = Some(reason);
            break;
        }
        if scanned_files >= limits.max_files {
            stop_reason = Some(STOP_FILE_LIMIT);
            break;
        }
        let Ok(entry) = entry else {
            unreadable_files += 1;
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            unreadable_files += 1;
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        scanned_files += 1;
        if metadata.len() > limits.max_file_bytes as u64 {
            skipped_oversized_files += 1;
            continue;
        }

        let bytes = match fs::read(entry.path()) {
            Ok(bytes) => bytes,
            Err(_) => {
                unreadable_files += 1;
                continue;
            }
        };
        if is_binary(&bytes) {
            skipped_binary_files += 1;
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut file_matches = 0usize;
        for (index, line) in text.lines().enumerate() {
            if let Some(reason) = interrupt_reason(interrupt) {
                stop_reason = Some(reason);
                break 'walk;
            }
            let Some(found) = matcher.find(line) else {
                continue;
            };
            file_matches += 1;
            matches.push(SearchMatch {
                path: relative.clone(),
                line: index + 1,
                column: char_column(line, found.start()),
                preview: preview(line),
                preview_truncated: line.char_indices().count() > MAX_PREVIEW_CHARS,
            });
            if file_matches >= limits.max_matches_per_file {
                capped_files += 1;
                break;
            }
            if matches.len() >= limits.max_results {
                stop_reason = Some(STOP_RESULT_LIMIT);
                break 'walk;
            }
        }
        if matches.len() >= limits.max_results {
            stop_reason = Some(STOP_RESULT_LIMIT);
            break;
        }
    }

    Ok(SearchResult {
        root: root.to_string_lossy().into_owned(),
        path: relative_to_root(&root, &scope),
        query: query.to_owned(),
        regex: params.regex.unwrap_or(false),
        case_sensitive,
        include_hidden,
        truncated: stop_reason.is_some() || capped_files > 0,
        stop_reason,
        capped_files,
        scanned_files,
        skipped_binary_files,
        skipped_oversized_files,
        unreadable_files,
        matches,
        limits,
        duration_ms: crate::scheduler::now_ms().saturating_sub(started_at),
    })
}

fn interrupt_reason(interrupt: &Interrupt) -> Option<&'static str> {
    match interrupt.stop_reason() {
        Some(crate::deadline::StopReason::Canceled) => Some(STOP_CANCELED),
        Some(crate::deadline::StopReason::DeadlineExceeded) => Some(STOP_DEADLINE),
        None => None,
    }
}

/// A query with no upper-case letter is almost always a provisional search, so it
/// matches case-insensitively; one with upper case is deliberate and matches exactly.
fn query_needs_case(query: &str) -> bool {
    query.chars().any(char::is_uppercase)
}

fn build_matcher(query: &str, regex: bool, case_sensitive: bool) -> Result<Regex> {
    let pattern = if regex {
        query.to_owned()
    } else {
        regex::escape(query)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .size_limit(4 * 1024 * 1024)
        .build()
        .map_err(|error| {
            coded(
                CODE_INVALID_PARAMS,
                format!("invalid search pattern: {error}"),
            )
        })
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|byte| *byte == 0)
}

fn char_column(line: &str, byte_offset: usize) -> usize {
    line[..byte_offset.min(line.len())].chars().count() + 1
}

fn preview(line: &str) -> String {
    line.chars().take(MAX_PREVIEW_CHARS).collect::<String>()
}

fn relative_to_root(root: &Path, target: &Path) -> String {
    let relative = target
        .strip_prefix(root)
        .unwrap_or(target)
        .to_string_lossy()
        .replace('\\', "/");
    if relative.is_empty() {
        ".".to_owned()
    } else {
        relative
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fixture(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("nd-core-search-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src").join("alpha.ts"),
            "const needle = 1\nother line\nNeEdLe again\n",
        )
        .unwrap();
        fs::write(root.join("src").join("beta.ts"), "no match here\n").unwrap();
        fs::write(root.join("binary.bin"), b"\x00\x01\x02needle\x00").unwrap();
        // Few enough matches per file to stay under the per-file bound, so a test
        // that wants a complete scan gets one. A test that wants a capped file adds
        // that file itself.
        fs::write(root.join("big.txt"), "needle\n".repeat(4)).unwrap();
        fs::write(root.join("node_modules-ignore-me"), "").unwrap();
        fs::write(root.join(".gitignore"), "ignored-directory/\nignored.js\n").unwrap();
        fs::create_dir_all(root.join("ignored-directory")).unwrap();
        fs::write(
            root.join("ignored-directory").join("inner.ts"),
            "needle inside ignored dir\n",
        )
        .unwrap();
        root
    }

    fn run(params: SearchParams) -> SearchResult {
        search(params, &Interrupt::never()).unwrap()
    }

    fn params(root: &Path, query: &str) -> SearchParams {
        SearchParams {
            root: root.to_string_lossy().into_owned(),
            query: query.into(),
            path: ".".into(),
            regex: None,
            case_sensitive: None,
            include_hidden: Some(true),
            max_results: None,
            max_matches_per_file: None,
            max_files: None,
            max_file_bytes: None,
        }
    }

    #[test]
    fn finds_matches_with_line_and_column_and_reports_a_complete_scan() {
        let root = fixture("complete");
        let result = run(params(&root, "needle"));
        assert!(!result.truncated);
        assert!(result.stop_reason.is_none());
        let paths = result
            .matches
            .iter()
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"src/alpha.ts"));
        let first = result
            .matches
            .iter()
            .find(|item| item.path == "src/alpha.ts")
            .unwrap();
        assert_eq!(first.line, 1);
        assert_eq!(first.column, 7);
        assert!(first.preview.contains("needle"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn honors_ignore_rules_and_never_reports_binary_matches() {
        let root = fixture("ignore");
        let result = run(params(&root, "needle"));
        let paths = result
            .matches
            .iter()
            .map(|item| item.path.clone())
            .collect::<Vec<_>>();
        assert!(
            !paths
                .iter()
                .any(|path| path.starts_with("ignored-directory/"))
        );
        assert!(!paths.contains(&"binary.bin".to_owned()));
        assert!(result.skipped_binary_files >= 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hidden_paths_are_skipped_by_default_and_opted_into_explicitly() {
        let root = fixture("hidden");
        fs::create_dir_all(root.join(".github")).unwrap();
        fs::write(
            root.join(".github").join("workflow.yml"),
            "needle in a dot directory\n",
        )
        .unwrap();

        let mut default_scan = params(&root, "needle");
        default_scan.include_hidden = None;
        let default_result = run(default_scan);
        assert!(!default_result.include_hidden);
        assert!(
            !default_result
                .matches
                .iter()
                .any(|item| item.path.starts_with(".github/"))
        );

        let mut explicit = params(&root, "needle");
        explicit.include_hidden = Some(true);
        let explicit_result = run(explicit);
        assert!(
            explicit_result
                .matches
                .iter()
                .any(|item| item.path.starts_with(".github/"))
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reports_truncation_instead_of_returning_a_silently_capped_view() {
        let root = fixture("truncation");
        let mut capped = params(&root, "needle");
        capped.max_results = Some(1);
        let result = run(capped);
        assert!(result.truncated);
        assert_eq!(result.stop_reason, Some(STOP_RESULT_LIMIT));
        assert_eq!(result.matches.len(), 1);

        fs::write(
            root.join("many.txt"),
            "needle in a file with a lot of matches
"
            .repeat(60),
        )
        .unwrap();
        fs::write(
            root.join("many.txt"),
            "needle in a file with a lot of matches\n".repeat(60),
        )
        .unwrap();
        let mut per_file = params(&root, "needle");
        per_file.max_matches_per_file = Some(1);
        let per_file_result = run(per_file);
        assert!(per_file_result.truncated);
        assert!(per_file_result.capped_files >= 1);
        assert!(per_file_result.stop_reason.is_none());

        let oversized = fixture("oversized");
        let mut limited = params(&oversized, "needle");
        limited.max_file_bytes = Some(8);
        let limited_result = run(limited);
        assert!(limited_result.skipped_oversized_files >= 1);
        // Skipping is not truncating: no match was dropped by that bound.
        assert!(limited_result.stop_reason.is_none());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&oversized);
    }

    #[test]
    fn file_limit_stops_the_scan_and_says_so() {
        let root = fixture("file-limit");
        let mut limited = params(&root, "needle");
        limited.max_files = Some(1);
        let result = run(limited);
        assert!(result.truncated);
        assert_eq!(result.stop_reason, Some(STOP_FILE_LIMIT));
        assert_eq!(result.scanned_files, 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deadline_and_cancellation_stop_the_scan_without_failing_the_request() {
        let root = fixture("stop");
        let registry = crate::deadline::InterruptRegistry::new();
        let canceled = registry.register("search", None);
        assert!(registry.cancel("search"));
        let result = search(params(&root, "needle"), &canceled).unwrap();
        assert!(result.truncated);
        assert_eq!(result.stop_reason, Some(STOP_CANCELED));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn regex_mode_rejects_an_invalid_pattern_as_invalid_params() {
        let root = fixture("regex");
        let mut broken = params(&root, "(unclosed");
        broken.regex = Some(true);
        let error = search(broken, &Interrupt::never()).unwrap_err();
        assert_eq!(crate::errors::code_of(&error), CODE_INVALID_PARAMS);

        let mut working = params(&root, "ne+dle");
        working.regex = Some(true);
        let result = run(working);
        assert!(!result.matches.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn search_cannot_escape_the_workspace_root() {
        let root = fixture("escape");
        let mut escaping = params(&root, "needle");
        escaping.path = "../".into();
        let error = search(escaping, &Interrupt::never()).unwrap_err();
        assert!(format!("{error:#}").contains("escapes the root"));
        let _ = fs::remove_dir_all(&root);
    }
}
