use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_RECORD_BYTES: usize = 256 * 1024;
const MAX_DATA_BYTES: usize = 64 * 1024;
pub const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;
const DEFAULT_REPLAY_LIMIT: usize = 1_000;
const HARD_REPLAY_LIMIT: usize = 10_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EffectState {
    Intent,
    Complete,
    Failed,
    Uncertain,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryState {
    NotStarted,
    KnownComplete,
    KnownFailed,
    OutcomeUncertain,
    InProgress,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRecord {
    pub seq: u64,
    pub record_id: String,
    pub time: u64,
    pub kind: String,
    pub state: EffectState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalConfigureParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalAppendParams {
    pub record_id: Option<String>,
    pub kind: String,
    pub state: EffectState,
    pub company_id: Option<String>,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub resource_id: Option<String>,
    pub idempotency_key: Option<String>,
    pub data: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalAppendResult {
    pub record: EffectRecord,
    pub duplicate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalReplayParams {
    #[serde(default)]
    pub after_seq: Option<u64>,
    #[serde(default = "default_replay_limit")]
    pub limit: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalReplayResult {
    pub records: Vec<EffectRecord>,
    pub last_seq: u64,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalStateParams {
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalStateResult {
    pub state: RecoveryState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<EffectRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectJournalStats {
    pub configured: bool,
    pub record_count: usize,
    pub bytes: u64,
    pub last_seq: u64,
    pub max_bytes: u64,
}

#[derive(Default)]
struct JournalState {
    path: Option<PathBuf>,
    records: Vec<EffectRecord>,
    latest_by_key: HashMap<String, usize>,
    completed_by_key: HashMap<String, usize>,
    recovered_uncertain_keys: HashSet<String>,
    bytes: u64,
}

pub struct EffectJournalStore {
    state: Mutex<JournalState>,
}

impl EffectJournalStore {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(JournalState::default()),
        }
    }

    pub fn configure(&self, params: EffectJournalConfigureParams) -> Result<EffectJournalStats> {
        let path = validate_path(&params.path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("create effect journal directory {}", parent.display())
            })?;
        }
        if !path.exists() {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .with_context(|| format!("create effect journal {}", path.display()))?
                .sync_data()
                .context("sync new effect journal")?;
        }

        let mut next = JournalState {
            path: Some(path.clone()),
            ..JournalState::default()
        };
        load_records(&path, &mut next)?;
        mark_recovered_uncertain(&mut next);
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("effect journal lock poisoned"))?;
        *state = next;
        Ok(stats_locked(&state))
    }

    pub fn append(&self, params: EffectJournalAppendParams) -> Result<EffectJournalAppendResult> {
        validate_append(&params)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("effect journal lock poisoned"))?;
        let path = state
            .path
            .clone()
            .ok_or_else(|| anyhow::anyhow!("effect journal is not configured"))?;

        if let Some(key) = params.idempotency_key.as_deref() {
            if state.recovered_uncertain_keys.contains(key) && params.state == EffectState::Intent {
                bail!("effect outcome is uncertain after restart; reconcile the existing idempotency key before retry");
            }
            if let Some(index) = state.completed_by_key.get(key).copied() {
                return Ok(EffectJournalAppendResult {
                    record: state.records[index].clone(),
                    duplicate: true,
                });
            }
            if let Some(index) = state.latest_by_key.get(key).copied() {
                let latest = &state.records[index];
                if latest.state == EffectState::Uncertain && params.state == EffectState::Intent {
                    bail!("effect outcome is uncertain; reconcile the existing idempotency key before retry");
                }
                if latest.state == EffectState::Intent && params.state == EffectState::Intent {
                    return Ok(EffectJournalAppendResult {
                        record: latest.clone(),
                        duplicate: true,
                    });
                }
            }
        }

        let seq = state.records.last().map(|record| record.seq + 1).unwrap_or(1);
        let record = EffectRecord {
            seq,
            record_id: params.record_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            time: now_ms(),
            kind: params.kind,
            state: params.state,
            company_id: params.company_id,
            project_id: params.project_id,
            task_id: params.task_id,
            run_id: params.run_id,
            resource_id: params.resource_id,
            idempotency_key: params.idempotency_key,
            data: params.data,
        };
        let mut encoded = serde_json::to_vec(&record).context("encode effect journal record")?;
        if encoded.len() > MAX_RECORD_BYTES {
            bail!("effect journal record exceeds {MAX_RECORD_BYTES} bytes");
        }
        encoded.push(b'\n');
        if state.bytes.saturating_add(encoded.len() as u64) > MAX_JOURNAL_BYTES {
            bail!("effect journal reached its {} byte retention bound; archive/reset policy is required before more effects can run", MAX_JOURNAL_BYTES);
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("open effect journal {}", path.display()))?;
        file.write_all(&encoded).context("append effect journal record")?;
        file.flush().context("flush effect journal record")?;
        file.sync_data().context("sync effect journal record")?;

        let index = state.records.len();
        state.bytes = state.bytes.saturating_add(encoded.len() as u64);
        if let Some(key) = record.idempotency_key.as_ref() {
            state.latest_by_key.insert(key.clone(), index);
            if record.state == EffectState::Complete {
                state.completed_by_key.insert(key.clone(), index);
            }
            if record.state != EffectState::Intent {
                state.recovered_uncertain_keys.remove(key);
            }
        }
        state.records.push(record.clone());
        Ok(EffectJournalAppendResult {
            record,
            duplicate: false,
        })
    }

    pub fn replay(&self, params: EffectJournalReplayParams) -> Result<EffectJournalReplayResult> {
        let state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("effect journal lock poisoned"))?;
        if state.path.is_none() {
            bail!("effect journal is not configured");
        }
        let limit = params.limit.clamp(1, HARD_REPLAY_LIMIT);
        let after = params.after_seq.unwrap_or(0);
        let mut matching = state.records.iter().filter(|record| record.seq > after);
        let records = matching
            .by_ref()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>();
        let truncated = matching.next().is_some();
        Ok(EffectJournalReplayResult {
            last_seq: state.records.last().map(|record| record.seq).unwrap_or(0),
            records,
            truncated,
        })
    }

    pub fn effect_state(&self, params: EffectJournalStateParams) -> Result<EffectJournalStateResult> {
        validate_id("idempotencyKey", &params.idempotency_key)?;
        let state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("effect journal lock poisoned"))?;
        let Some(index) = state.latest_by_key.get(&params.idempotency_key).copied() else {
            return Ok(EffectJournalStateResult {
                state: RecoveryState::NotStarted,
                record: None,
            });
        };
        let record = state.records[index].clone();
        let recovery = if state.recovered_uncertain_keys.contains(&params.idempotency_key) {
            RecoveryState::OutcomeUncertain
        } else {
            match record.state {
            EffectState::Intent => RecoveryState::InProgress,
            EffectState::Complete => RecoveryState::KnownComplete,
            EffectState::Failed => RecoveryState::KnownFailed,
            EffectState::Uncertain => RecoveryState::OutcomeUncertain,
            }
        };
        Ok(EffectJournalStateResult {
            state: recovery,
            record: Some(record),
        })
    }

    pub fn stats(&self) -> EffectJournalStats {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        stats_locked(&state)
    }
}

fn load_records(path: &Path, state: &mut JournalState) -> Result<()> {
    let file = File::open(path).with_context(|| format!("open effect journal {}", path.display()))?;
    for (line_index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.with_context(|| format!("read effect journal line {}", line_index + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        let record: EffectRecord = serde_json::from_str(&line)
            .with_context(|| format!("decode effect journal line {}", line_index + 1))?;
        if let Some(previous) = state.records.last()
            && record.seq <= previous.seq
        {
            bail!("effect journal sequence is not strictly increasing");
        }
        let index = state.records.len();
        if let Some(key) = record.idempotency_key.as_ref() {
            state.latest_by_key.insert(key.clone(), index);
            if record.state == EffectState::Complete {
                state.completed_by_key.insert(key.clone(), index);
            }
        }
        state.bytes = state.bytes.saturating_add((line.len() + 1) as u64);
        state.records.push(record);
    }
    Ok(())
}

fn mark_recovered_uncertain(state: &mut JournalState) {
    for (key, index) in &state.latest_by_key {
        if state.records[*index].state == EffectState::Intent {
            state.recovered_uncertain_keys.insert(key.clone());
        }
    }
}

fn validate_path(value: &str) -> Result<PathBuf> {
    if value.trim().is_empty() || value.len() > 4096 {
        bail!("invalid effect journal path");
    }
    Ok(PathBuf::from(value))
}

fn validate_append(params: &EffectJournalAppendParams) -> Result<()> {
    if params.kind.trim().is_empty() || params.kind.len() > 128 {
        bail!("invalid effect journal kind");
    }
    for (name, value) in [
        ("recordId", params.record_id.as_deref()),
        ("companyId", params.company_id.as_deref()),
        ("projectId", params.project_id.as_deref()),
        ("taskId", params.task_id.as_deref()),
        ("runId", params.run_id.as_deref()),
        ("resourceId", params.resource_id.as_deref()),
        ("idempotencyKey", params.idempotency_key.as_deref()),
    ] {
        if let Some(value) = value {
            validate_id(name, value)?;
        }
    }
    if let Some(data) = params.data.as_ref()
        && serde_json::to_vec(data).context("encode effect journal data")?.len() > MAX_DATA_BYTES
    {
        bail!("effect journal data exceeds {MAX_DATA_BYTES} bytes");
    }
    Ok(())
}

fn validate_id(name: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 {
        bail!("invalid effect journal {name}");
    }
    Ok(())
}

fn stats_locked(state: &JournalState) -> EffectJournalStats {
    EffectJournalStats {
        configured: state.path.is_some(),
        record_count: state.records.len(),
        bytes: state.bytes,
        last_seq: state.records.last().map(|record| record.seq).unwrap_or(0),
        max_bytes: MAX_JOURNAL_BYTES,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn default_replay_limit() -> usize {
    DEFAULT_REPLAY_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nd-effect-{name}-{}.jsonl", Uuid::new_v4()))
    }

    fn params(key: &str, state: EffectState) -> EffectJournalAppendParams {
        EffectJournalAppendParams {
            record_id: None,
            kind: "external.effect".into(),
            state,
            company_id: Some("company".into()),
            project_id: Some("project".into()),
            task_id: Some("task".into()),
            run_id: Some("run".into()),
            resource_id: None,
            idempotency_key: Some(key.into()),
            data: Some(serde_json::json!({"safe": true})),
        }
    }

    #[test]
    fn restart_does_not_duplicate_known_complete_effect() {
        let path = journal_path("complete");
        let first = EffectJournalStore::new();
        first
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        let written = first.append(params("effect-1", EffectState::Complete)).unwrap();
        assert!(!written.duplicate);
        drop(first);

        let second = EffectJournalStore::new();
        second
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        let duplicate = second.append(params("effect-1", EffectState::Intent)).unwrap();
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.record.seq, written.record.seq);
        assert_eq!(second.stats().record_count, 1);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn unmatched_intent_becomes_uncertain_after_restart() {
        let path = journal_path("intent-restart");
        let first = EffectJournalStore::new();
        first
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        first.append(params("effect-intent", EffectState::Intent)).unwrap();
        drop(first);

        let second = EffectJournalStore::new();
        second
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        let recovered = second
            .effect_state(EffectJournalStateParams {
                idempotency_key: "effect-intent".into(),
            })
            .unwrap();
        assert_eq!(recovered.state, RecoveryState::OutcomeUncertain);
        let retry = second.append(params("effect-intent", EffectState::Intent));
        assert!(retry.is_err());
        let reconciled = second
            .append(params("effect-intent", EffectState::Failed))
            .unwrap();
        assert_eq!(reconciled.record.state, EffectState::Failed);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn uncertain_outcome_blocks_blind_retry_until_reconciled() {
        let path = journal_path("uncertain-retry");
        let store = EffectJournalStore::new();
        store
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        store.append(params("effect-3", EffectState::Uncertain)).unwrap();
        let error = store
            .append(params("effect-3", EffectState::Intent))
            .unwrap_err();
        assert!(format!("{error:#}").contains("reconcile"));
        let reconciled = store
            .append(params("effect-3", EffectState::Failed))
            .unwrap();
        assert_eq!(reconciled.record.state, EffectState::Failed);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn uncertain_outcome_survives_restart_explicitly() {
        let path = journal_path("uncertain");
        let first = EffectJournalStore::new();
        first
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        first.append(params("effect-2", EffectState::Uncertain)).unwrap();
        drop(first);

        let second = EffectJournalStore::new();
        second
            .configure(EffectJournalConfigureParams {
                path: path.to_string_lossy().into_owned(),
            })
            .unwrap();
        let state = second
            .effect_state(EffectJournalStateParams {
                idempotency_key: "effect-2".into(),
            })
            .unwrap();
        assert_eq!(state.state, RecoveryState::OutcomeUncertain);
        let _ = fs::remove_file(path);
    }
}
