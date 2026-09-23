//! Revision markers: a cheap answer to "is previously read state still valid?".
//!
//! Every marker in this module is a content-derived fingerprint of exactly the state
//! the described read depends on. It is computed from `stat` data and small Git
//! metadata files — never by re-running the read it guards — so comparing markers is
//! strictly cheaper than repeating the work, and a mutation outside nd-core still
//! moves the marker rather than serving a stale result.
//!
//! Two scopes exist because two reads depend on different things:
//! * [`RevisionScope::GitRefs`] covers HEAD, loose refs, `packed-refs`, and the other
//!   in-progress-operation files. History cannot change without one of them changing.
//! * [`RevisionScope::Worktree`] adds the working tree itself plus the Git index, which
//!   is what `git status` reports on.
//!
//! Stat data is the same signal Git's own index uses to decide whether a path needs
//! re-reading. Its known limit is the filesystem timestamp granularity: a write that
//! lands in the same tick with an unchanged size is invisible to any stat-based
//! fingerprint. Git guards that window with its "racily clean" index entry rule; this
//! module is used only to guard a *cache of a read that has already happened*, so the
//! consequence of the same window is bounded to one redundant cache hit at the same
//! nanosecond, never a wrong answer about a different revision.

use crate::deadline::Interrupt;
use crate::errors::{CODE_INVALID_PARAMS, coded};
use anyhow::{Context, Result, bail};
use ignore::WalkBuilder;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Upper bound on fingerprinted worktree entries. A tree past this is reported
/// non-authoritative instead of silently under-describing the state.
pub const MAX_WORKTREE_ENTRIES: usize = 50_000;
/// Upper bound on fingerprinted Git ref files.
pub const MAX_REF_ENTRIES: usize = 20_000;
/// Longest workspace-relative path accepted by a revision request.
const MAX_ROOT_LENGTH: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RevisionScope {
    Worktree,
    GitRefs,
}

impl RevisionScope {
    pub fn parse(value: Option<&str>) -> Result<Self> {
        match value.map(str::trim) {
            None | Some("") | Some("worktree") => Ok(Self::Worktree),
            Some("gitRefs") | Some("git-refs") => Ok(Self::GitRefs),
            Some(other) => Err(coded(
                CODE_INVALID_PARAMS,
                format!("unknown revision scope: {other}"),
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Worktree => "worktree",
            Self::GitRefs => "gitRefs",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// Hex digest of the fingerprinted state.
    pub value: String,
    pub scope: &'static str,
    pub root: String,
    pub entries: usize,
    pub skipped_entries: usize,
    /// The fingerprint stopped at its bound, so it describes only part of the state.
    pub truncated: bool,
    pub duration_ms: u64,
}

impl Revision {
    /// Whether this marker may gate a cache. A truncated or partially unreadable
    /// fingerprint cannot promise that it moves with the state it describes, so the
    /// caller recomputes rather than risk an undetected stale hit.
    pub fn safe_for_cache(&self) -> bool {
        !self.truncated && self.skipped_entries == 0
    }
}

pub fn workspace_revision(
    root: &str,
    scope: RevisionScope,
    interrupt: &Interrupt,
) -> Result<Revision> {
    let started_at = crate::scheduler::now_ms();
    let root = canonical_root(root)?;
    let mut hasher = Sha256::new();
    let mut stats = FingerprintStats::default();

    match scope {
        RevisionScope::GitRefs => fingerprint_git_metadata(&root, &mut hasher, &mut stats, false)?,
        RevisionScope::Worktree => {
            fingerprint_git_metadata(&root, &mut hasher, &mut stats, true)?;
            fingerprint_worktree(&root, &mut hasher, &mut stats, interrupt)?;
        }
    }

    Ok(Revision {
        value: format!("{:x}", hasher.finalize()),
        scope: scope.as_str(),
        root: root.to_string_lossy().into_owned(),
        entries: stats.entries,
        skipped_entries: stats.skipped,
        truncated: stats.truncated,
        duration_ms: crate::scheduler::now_ms().saturating_sub(started_at),
    })
}

#[derive(Default)]
struct FingerprintStats {
    entries: usize,
    skipped: usize,
    truncated: bool,
}

impl FingerprintStats {
    fn record(&mut self, hasher: &mut Sha256, label: &[u8], metadata: &fs::Metadata) {
        self.entries += 1;
        hasher.update(label);
        hasher.update(metadata.len().to_le_bytes());
        hasher.update(metadata_kind(metadata).to_le_bytes());
        hasher.update(modified_nanos(metadata).to_le_bytes());
    }
}

/// Fingerprint the working tree in Git's own ignore terms: a path Git would not
/// report on cannot change what Git reports.
fn fingerprint_worktree(
    root: &Path,
    hasher: &mut Sha256,
    stats: &mut FingerprintStats,
    interrupt: &Interrupt,
) -> Result<()> {
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .ignore(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .parents(false)
        .follow_links(false)
        .sort_by_file_name(|left, right| left.cmp(right))
        .filter_entry(|entry| !is_git_metadata(entry))
        .build();

    for entry in walker {
        interrupt.check("workspace.revision")?;
        if stats.entries >= MAX_WORKTREE_ENTRIES {
            stats.truncated = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };
        let relative = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        if relative.is_empty() {
            continue;
        }
        match entry.metadata() {
            Ok(metadata) => stats.record(hasher, relative.as_bytes(), &metadata),
            Err(_) => stats.skipped += 1,
        }
    }
    Ok(())
}

/// Fingerprint the Git state files that decide what Git reports.
///
/// `include_index` is what separates the two scopes: `git log` does not depend on the
/// index, `git status` does.
fn fingerprint_git_metadata(
    root: &Path,
    hasher: &mut Sha256,
    stats: &mut FingerprintStats,
    include_index: bool,
) -> Result<()> {
    let Some(git_dir) = worktree_git_dir(root) else {
        hasher.update(b"no-git-directory");
        return Ok(());
    };
    let common_dir = common_git_dir(&git_dir).unwrap_or_else(|| git_dir.clone());

    for dir in distinct_dirs(&git_dir, &common_dir) {
        let mut files = vec![
            "HEAD",
            "packed-refs",
            "ORIG_HEAD",
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "FETCH_HEAD",
            "BISECT_LOG",
            "shallow",
            "config",
        ];
        if include_index {
            files.push("index");
        }
        for name in files {
            fingerprint_file(&dir.join(name), hasher, stats);
        }
        fingerprint_refs(&dir.join("refs"), hasher, stats)?;
    }
    Ok(())
}

fn fingerprint_file(path: &Path, hasher: &mut Sha256, stats: &mut FingerprintStats) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if !metadata.is_file() {
        return;
    }
    // Ref-sized files only: `index` is metadata-stamped rather than read, and a file
    // larger than this is not a ref, so hashing it would only add cost.
    if metadata.len() <= 64 * 1024
        && let Ok(bytes) = fs::read(path)
    {
        let label = path.to_string_lossy();
        stats.entries += 1;
        hasher.update(format!("file:{label}").as_bytes());
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
}

fn fingerprint_refs(refs: &Path, hasher: &mut Sha256, stats: &mut FingerprintStats) -> Result<()> {
    if !refs.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(refs).with_context(|| format!("read {}", refs.display()))? {
        if stats.entries >= MAX_REF_ENTRIES {
            stats.truncated = true;
            return Ok(());
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                stats.skipped += 1;
                continue;
            }
        };
        if metadata.is_dir() {
            fingerprint_refs(&path, hasher, stats)?;
        } else if metadata.is_file() {
            fingerprint_file(&path, hasher, stats);
        }
    }
    Ok(())
}

fn distinct_dirs(git_dir: &Path, common_dir: &Path) -> Vec<PathBuf> {
    if git_dir == common_dir {
        vec![git_dir.to_path_buf()]
    } else {
        vec![git_dir.to_path_buf(), common_dir.to_path_buf()]
    }
}

/// `.git` is a directory in a normal checkout and a `gitdir:` pointer file in a
/// linked worktree. nd-core owns task worktrees, so both shapes are normal here.
fn worktree_git_dir(root: &Path) -> Option<PathBuf> {
    let dot_git = root.join(".git");
    let metadata = fs::symlink_metadata(&dot_git).ok()?;
    if metadata.is_dir() {
        return Some(dot_git);
    }
    let text = fs::read_to_string(&dot_git).ok()?;
    let target = text.trim().strip_prefix("gitdir:")?.trim().to_owned();
    let target = PathBuf::from(target);
    Some(if target.is_absolute() {
        target
    } else {
        root.join(target)
    })
}

fn common_git_dir(git_dir: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(git_dir.join("commondir")).ok()?;
    let target = PathBuf::from(text.trim());
    Some(if target.is_absolute() {
        target
    } else {
        git_dir.join(target)
    })
}

fn is_git_metadata(entry: &ignore::DirEntry) -> bool {
    entry.depth() == 1 && entry.file_name() == ".git"
}

fn canonical_root(root: &str) -> Result<PathBuf> {
    if root.trim().is_empty() || root.len() > MAX_ROOT_LENGTH {
        bail!("invalid workspace root");
    }
    let root = fs::canonicalize(root).context("workspace root is unavailable")?;
    if !fs::metadata(&root)?.is_dir() {
        bail!("workspace root is not a directory");
    }
    Ok(root)
}

fn metadata_kind(metadata: &fs::Metadata) -> u8 {
    if metadata.file_type().is_symlink() {
        2
    } else if metadata.is_dir() {
        1
    } else {
        0
    }
}

fn modified_nanos(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use uuid::Uuid;

    fn temp_dir(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("nd-core-revision-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn revision_of(root: &Path) -> Revision {
        workspace_revision(
            &root.to_string_lossy(),
            RevisionScope::Worktree,
            &Interrupt::never(),
        )
        .unwrap()
    }

    #[test]
    fn marker_moves_when_described_state_changes_and_holds_when_it_does_not() {
        let root = temp_dir("worktree");
        fs::write(root.join("file.txt"), "first version\n").unwrap();

        let before = revision_of(&root);
        let unchanged = revision_of(&root);
        assert_eq!(
            before.value, unchanged.value,
            "a read-only check must not move the marker"
        );

        fs::write(root.join("file.txt"), "second version, different length\n").unwrap();
        let after_edit = revision_of(&root);
        assert_ne!(
            before.value, after_edit.value,
            "an external edit must move the marker"
        );

        fs::write(root.join("added.txt"), "new file\n").unwrap();
        let after_add = revision_of(&root);
        assert_ne!(
            after_edit.value, after_add.value,
            "an external add must move the marker"
        );

        fs::remove_file(root.join("added.txt")).unwrap();
        let after_remove = revision_of(&root);
        assert_ne!(after_add.value, after_remove.value);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn git_metadata_scope_ignores_worktree_edits_but_tracks_refs() {
        let root = temp_dir("git-scope");
        let git = root.join(".git");
        fs::create_dir_all(git.join("refs").join("heads")).unwrap();
        fs::write(git.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(
            git.join("refs").join("heads").join("main"),
            "a".repeat(40) + "\n",
        )
        .unwrap();
        fs::write(root.join("tracked.txt"), "content\n").unwrap();

        let scope_of = |scope| {
            workspace_revision(&root.to_string_lossy(), scope, &Interrupt::never())
                .unwrap()
                .value
        };
        let before = scope_of(RevisionScope::GitRefs);

        // A worktree edit does not move the refs marker: history did not change.
        std::thread::sleep(Duration::from_millis(20));
        fs::write(
            root.join("tracked.txt"),
            "edited content with a new length\n",
        )
        .unwrap();
        assert_eq!(before, scope_of(RevisionScope::GitRefs));

        // A ref update does.
        fs::write(
            git.join("refs").join("heads").join("main"),
            "b".repeat(40) + "\n",
        )
        .unwrap();
        assert_ne!(before, scope_of(RevisionScope::GitRefs));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_scope_is_rejected_rather_than_defaulted() {
        let error = RevisionScope::parse(Some("everything")).unwrap_err();
        assert_eq!(crate::errors::code_of(&error), CODE_INVALID_PARAMS);
        assert_eq!(RevisionScope::parse(None).unwrap(), RevisionScope::Worktree);
    }
}
