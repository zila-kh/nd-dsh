//! Workspace-relative filesystem primitives.
//!
//! This module is the single filesystem layer the product uses for reading a linked
//! workspace. Every entry point resolves through [`resolve_existing_from_root`], so a
//! path that escapes the active workspace root — by `..`, by an absolute path, or by
//! a symlink whose target leaves the root — is rejected before any filesystem access.
//!
//! Reads and listings are bounded and say so: a caller always learns whether it saw
//! everything, instead of silently receiving a truncated view.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Default bound for a single file read. Matches the product's existing workspace
/// file-view limit.
const DEFAULT_MAX_READ: usize = 1024 * 1024;
/// Hard bound for a single file read. Derived from the protocol frame bound: a larger
/// payload could not be framed, and failing after the read would be a worse error
/// than refusing the bound up front.
const HARD_MAX_READ: usize = crate::protocol::MAX_FRAME_BYTES / 2;
/// Default directory-listing bound, matching the product's workspace browser.
const DEFAULT_MAX_LIST_ENTRIES: usize = 500;
const HARD_MAX_LIST_ENTRIES: usize = 4096;
const MAX_PATH_LENGTH: usize = 4096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    pub root: String,
    #[serde(default = "default_relative")]
    pub path: String,
    pub max_entries: Option<usize>,
}

fn default_relative() -> String {
    ".".to_owned()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadParams {
    pub root: String,
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntry {
    pub name: String,
    /// Workspace-relative path with `/` separators, so the shape is identical on
    /// every platform.
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub root: String,
    pub path: String,
    pub entries: Vec<ListEntry>,
    /// The bound stopped the listing. A truncated listing is never presented as a
    /// complete one.
    pub truncated: bool,
    pub max_entries: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub root: String,
    pub path: String,
    pub data: String,
    pub size: usize,
    /// The file is larger than the requested bound; `data` holds the leading bytes.
    pub truncated: bool,
    pub max_bytes: usize,
    pub byte_size: u64,
}

pub fn list(params: ListParams) -> Result<ListResult> {
    let root = canonical_root(&params.root)?;
    let target = resolve_existing_from_root(&root, &params.path)?;
    let metadata = fs::metadata(&target)?;
    if !metadata.is_dir() {
        bail!("workspace list target is not a directory");
    }
    let max_entries = params
        .max_entries
        .unwrap_or(DEFAULT_MAX_LIST_ENTRIES)
        .clamp(1, HARD_MAX_LIST_ENTRIES);

    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(&target)? {
        let entry = entry?;
        if entries.len() >= max_entries {
            truncated = true;
            break;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(ListEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: relative,
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
            is_symlink: metadata.file_type().is_symlink(),
            size: metadata.len(),
        });
    }
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    Ok(ListResult {
        root: root.to_string_lossy().into_owned(),
        path: relative_to_root(&root, &target),
        entries,
        truncated,
        max_entries,
    })
}

/// Bounded read: the returned payload never exceeds the resolved bound, and
/// `truncated` distinguishes a whole file from its leading bytes.
pub fn read(params: ReadParams) -> Result<ReadResult> {
    let root = canonical_root(&params.root)?;
    let target = resolve_existing_from_root(&root, &params.path)?;
    let metadata = fs::metadata(&target)?;
    if !metadata.is_file() {
        bail!("workspace read target is not a file");
    }
    let max_bytes = params
        .max_bytes
        .unwrap_or(DEFAULT_MAX_READ)
        .clamp(1, HARD_MAX_READ);
    let byte_size = metadata.len();
    let truncated = byte_size > max_bytes as u64;

    let bytes = if truncated {
        fs::read(&target)?
            .into_iter()
            .take(max_bytes)
            .collect::<Vec<u8>>()
    } else {
        fs::read(&target)?
    };
    let data = String::from_utf8(bytes).context("workspace file is not valid UTF-8")?;
    let size = data.len();
    Ok(ReadResult {
        root: root.to_string_lossy().into_owned(),
        path: relative_to_root(&root, &target),
        data,
        size,
        truncated,
        max_bytes,
        byte_size,
    })
}

/// Resolve an existing workspace-relative path, rejecting escapes.
pub(crate) fn resolve_existing_from_root(root: &Path, relative: &str) -> Result<PathBuf> {
    let relative = validate_relative(relative)?;
    let target = fs::canonicalize(root.join(relative)).context("workspace path is unavailable")?;
    ensure_inside(root, &target)?;
    Ok(target)
}

pub(crate) fn canonical_root(root: &str) -> Result<PathBuf> {
    if root.trim().is_empty() || root.len() > MAX_PATH_LENGTH {
        bail!("invalid workspace root");
    }
    let root = fs::canonicalize(root).context("workspace root is unavailable")?;
    if !fs::metadata(&root)?.is_dir() {
        bail!("workspace root is not a directory");
    }
    Ok(root)
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

fn validate_relative(path: &str) -> Result<PathBuf> {
    if path.len() > MAX_PATH_LENGTH {
        bail!("workspace path is too long");
    }

    // The RPC path contract is platform-neutral. A Windows absolute path must
    // still be rejected when nd-core happens to run on Linux/macOS (and vice
    // versa), otherwise a value such as C:/Windows is treated as a relative
    // filename and fails later with the misleading "path is unavailable".
    let bytes = path.as_bytes();
    let windows_drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    let windows_unc_absolute = path.starts_with("\\\\") || path.starts_with("//");
    if windows_drive_absolute || windows_unc_absolute {
        bail!("workspace path must be relative");
    }

    // Interpret either path separator when looking for a parent traversal so
    // the safety boundary is identical on every host OS.
    if path.split(['/', '\\']).any(|segment| segment == "..") {
        bail!("workspace path escapes the root");
    }

    let value = Path::new(path);
    if value.is_absolute() {
        bail!("workspace path must be relative");
    }
    for component in value.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                bail!("workspace path escapes the root")
            }
            _ => {}
        }
    }
    Ok(value.to_path_buf())
}

fn ensure_inside(root: &Path, target: &Path) -> Result<()> {
    if target == root || target.starts_with(root) {
        Ok(())
    } else {
        bail!("workspace path escapes the root")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("nd-core-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn root_of(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn rejects_parent_escape_before_filesystem_access() {
        let root = temp_root("workspace-parent");
        let outside = root.parent().unwrap().join("nd-core-outside.txt");
        fs::write(&outside, "outside").unwrap();
        let result = read(ReadParams {
            root: root_of(&root),
            path: "../nd-core-outside.txt".into(),
            max_bytes: None,
        });
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
        assert!(result.is_err());
        assert!(format!("{:#}", result.unwrap_err()).contains("escapes the root"));
    }

    #[test]
    fn rejects_absolute_and_prefix_paths() {
        let root = temp_root("workspace-absolute");
        for candidate in [
            "/etc/passwd",
            "C:/Windows/win.ini",
            "C:\\Windows\\win.ini",
            "\\\\server\\share",
            "..\\secrets.txt",
        ] {
            let result = list(ListParams {
                root: root_of(&root),
                path: candidate.into(),
                max_entries: None,
            });
            assert!(result.is_err(), "{candidate} was accepted");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn bounded_read_reports_truncation_instead_of_failing() {
        let root = temp_root("workspace-bounded-read");
        let body = "0123456789".repeat(32);
        fs::write(root.join("large.txt"), &body).unwrap();

        let whole = read(ReadParams {
            root: root_of(&root),
            path: "large.txt".into(),
            max_bytes: Some(4096),
        })
        .unwrap();
        assert!(!whole.truncated);
        assert_eq!(whole.size, body.len());

        let capped = read(ReadParams {
            root: root_of(&root),
            path: "large.txt".into(),
            max_bytes: Some(10),
        })
        .unwrap();
        assert!(capped.truncated);
        assert_eq!(capped.data.len(), 10);
        assert_eq!(capped.byte_size, body.len() as u64);

        // The hard bound keeps a requested read frameable, so it is clamped rather
        // than honoured.
        let clamped = read(ReadParams {
            root: root_of(&root),
            path: "large.txt".into(),
            max_bytes: Some(usize::MAX),
        })
        .unwrap();
        assert_eq!(clamped.max_bytes, HARD_MAX_READ);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn listing_reports_truncation_and_workspace_relative_paths() {
        let root = temp_root("workspace-list");
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested").join("child.txt"), "child").unwrap();

        let listing = list(ListParams {
            root: root_of(&root),
            path: ".".into(),
            max_entries: None,
        })
        .unwrap();
        assert!(!listing.truncated);
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].path, "nested");
        assert!(listing.entries[0].is_directory);

        let inner = list(ListParams {
            root: root_of(&root),
            path: "nested".into(),
            max_entries: Some(1),
        })
        .unwrap();
        assert_eq!(inner.path, "nested");
        assert!(!inner.truncated);

        for index in 0..5 {
            fs::write(root.join(format!("file-{index}.txt")), "x").unwrap();
        }
        let capped = list(ListParams {
            root: root_of(&root),
            path: ".".into(),
            max_entries: Some(2),
        })
        .unwrap();
        assert!(capped.truncated);
        assert_eq!(capped.entries.len(), 2);
        assert_eq!(capped.max_entries, 2);
        let _ = fs::remove_dir_all(&root);
    }

    /// Symlink escape coverage runs wherever the platform lets a test create a
    /// symlink: always on unix runners, and on Windows when Developer Mode or an
    /// elevated token allows it. Where the platform refuses the fixture, the test
    /// reports that it did not run rather than passing silently on a false premise.
    #[test]
    fn rejects_symlink_escape_on_read_and_list() {
        let root = temp_root("workspace-symlink-root");
        let outside = temp_root("workspace-symlink-outside");
        fs::write(outside.join("secret.txt"), "outside").unwrap();
        if let Err(error) = create_dir_symlink(&outside, &root.join("link")) {
            eprintln!("skipping symlink escape coverage: {error}");
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let read_result = read(ReadParams {
            root: root_of(&root),
            path: "link/secret.txt".into(),
            max_bytes: None,
        });
        assert!(read_result.is_err());
        assert!(format!("{:#}", read_result.unwrap_err()).contains("escapes the root"));

        let list_result = list(ListParams {
            root: root_of(&root),
            path: "link".into(),
            max_entries: None,
        });
        assert!(list_result.is_err());
        assert!(format!("{:#}", list_result.unwrap_err()).contains("escapes the root"));

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    fn create_dir_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn create_dir_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }
}
