use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

const DEFAULT_MAX_READ: usize = 4 * 1024 * 1024;
const MAX_LIST_ENTRIES: usize = 4096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathParams {
    pub root: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadParams {
    pub root: String,
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicWriteParams {
    pub root: String,
    pub path: String,
    pub data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatResult {
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub path: String,
    pub data: String,
    pub size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntry {
    pub name: String,
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub size: u64,
}

pub fn realpath(params: PathParams) -> Result<String> {
    let target = resolve_existing(&params.root, &params.path)?;
    Ok(target.to_string_lossy().into_owned())
}

pub fn stat(params: PathParams) -> Result<StatResult> {
    let target = resolve_existing(&params.root, &params.path)?;
    let metadata = fs::symlink_metadata(&target)?;
    Ok(StatResult {
        path: target.to_string_lossy().into_owned(),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symlink: metadata.file_type().is_symlink(),
        size: metadata.len(),
    })
}

pub fn read(params: ReadParams) -> Result<ReadResult> {
    let target = resolve_existing(&params.root, &params.path)?;
    let metadata = fs::metadata(&target)?;
    if !metadata.is_file() {
        bail!("workspace read target is not a file");
    }
    let max = params
        .max_bytes
        .unwrap_or(DEFAULT_MAX_READ)
        .clamp(1, 16 * 1024 * 1024);
    if metadata.len() > max as u64 {
        bail!("workspace read exceeds configured bound");
    }
    let bytes = fs::read(&target)?;
    let data = String::from_utf8(bytes).context("workspace file is not valid UTF-8")?;
    let size = data.len();
    Ok(ReadResult {
        path: target.to_string_lossy().into_owned(),
        data,
        size,
    })
}

pub fn list(params: PathParams) -> Result<Vec<ListEntry>> {
    let root = canonical_root(&params.root)?;
    let target = resolve_existing_from_root(&root, &params.path)?;
    let metadata = fs::metadata(&target)?;
    if !metadata.is_dir() {
        bail!("workspace list target is not a directory");
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&target)? {
        let entry = entry?;
        if entries.len() >= MAX_LIST_ENTRIES {
            bail!("workspace directory exceeds listing bound");
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
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

pub fn atomic_write(params: AtomicWriteParams) -> Result<StatResult> {
    if params.data.len() > 16 * 1024 * 1024 {
        bail!("workspace write exceeds configured bound");
    }
    let root = canonical_root(&params.root)?;
    let relative = validate_relative(&params.path)?;
    let target = root.join(relative);
    let parent = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("workspace write target has no parent"))?;
    let canonical_parent =
        fs::canonicalize(parent).context("workspace write parent is unavailable")?;
    ensure_inside(&root, &canonical_parent)?;

    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow::anyhow!("workspace write target name is invalid"))?;
    let temp = canonical_parent.join(format!(".{file_name}.nd-tmp-{}", std::process::id()));
    fs::write(&temp, params.data.as_bytes())?;
    fs::rename(&temp, &target)?;

    stat(PathParams {
        root: root.to_string_lossy().into_owned(),
        path: target
            .strip_prefix(&root)
            .unwrap_or(&target)
            .to_string_lossy()
            .into_owned(),
    })
}

fn resolve_existing(root: &str, relative: &str) -> Result<PathBuf> {
    let root = canonical_root(root)?;
    resolve_existing_from_root(&root, relative)
}

fn resolve_existing_from_root(root: &Path, relative: &str) -> Result<PathBuf> {
    let relative = validate_relative(relative)?;
    let target = fs::canonicalize(root.join(relative)).context("workspace path is unavailable")?;
    ensure_inside(root, &target)?;
    Ok(target)
}

fn canonical_root(root: &str) -> Result<PathBuf> {
    if root.trim().is_empty() || root.len() > 4096 {
        bail!("invalid workspace root");
    }
    let root = fs::canonicalize(root).context("workspace root is unavailable")?;
    if !fs::metadata(&root)?.is_dir() {
        bail!("workspace root is not a directory");
    }
    Ok(root)
}

fn validate_relative(path: &str) -> Result<PathBuf> {
    if path.len() > 4096 {
        bail!("workspace path is too long");
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
