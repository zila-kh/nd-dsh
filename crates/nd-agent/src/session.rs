use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl Message {
    pub fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.to_owned(),
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub messages: Vec<Message>,
    pub events: Vec<Value>,
    pub sequence: u64,
    pub running: bool,
}

impl Session {
    pub fn new(cwd: String) -> Self {
        let now = now_ms();
        Self {
            id: format!("nd-native-{}", Uuid::new_v4()),
            cwd,
            title: "New ND chat".to_owned(),
            created_at: now,
            updated_at: now,
            provider: None,
            model: None,
            messages: Vec::new(),
            events: Vec::new(),
            sequence: 0,
            running: false,
        }
    }

    pub fn record(&mut self, event_type: &str, data: Value) -> Value {
        self.sequence += 1;
        self.updated_at = now_ms();
        let event = json!({ "type": event_type, "seq": self.sequence, "time": self.updated_at, "data": data });
        self.events.push(event.clone());
        event
    }

    pub fn summary(&self) -> Value {
        json!({
            "sessionId": self.id, "engineId": "nd-native", "title": self.title,
            "cwd": self.cwd, "createdAt": self.created_at, "updatedAt": self.updated_at,
            "running": self.running,
        })
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Versioned snapshots avoid replacing an open file on Windows. A new snapshot
/// is complete before older snapshots are pruned; a torn write is ignored.
pub struct SessionStore {
    root: PathBuf,
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
}

impl SessionStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(&root).context("create ND agent session directory")?;
        let mut sessions = HashMap::new();
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            if !valid_session_id(&id) {
                continue;
            }
            if let Some(mut session) = load_latest(&entry.path())? {
                if session.id != id {
                    continue;
                }
                if session.running {
                    session.running = false;
                    session.record("agent/error", json!({ "message": "ND agent exited before the turn completed. The turn will not be replayed." }));
                }
                sessions.insert(id, Arc::new(Mutex::new(session)));
            }
        }
        Ok(Self {
            root,
            sessions: Mutex::new(sessions),
        })
    }

    pub fn create(&self, cwd: String) -> Result<Arc<Mutex<Session>>> {
        if cwd.trim().is_empty() {
            bail!("session workspace is required");
        }
        let session = Arc::new(Mutex::new(Session::new(cwd)));
        let id = session.lock().unwrap().id.clone();
        self.save(&session.lock().unwrap())?;
        self.sessions
            .lock()
            .unwrap()
            .insert(id, Arc::clone(&session));
        Ok(session)
    }

    pub fn get(&self, id: &str) -> Result<Arc<Mutex<Session>>> {
        if !valid_session_id(id) {
            bail!("invalid ND agent session id");
        }
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .context("ND agent session not found")
    }

    pub fn list(&self) -> Vec<Value> {
        let mut values: Vec<Value> = self
            .sessions
            .lock()
            .unwrap()
            .values()
            .map(|session| session.lock().unwrap().summary())
            .collect();
        values.sort_by(|left, right| right["updatedAt"].as_u64().cmp(&left["updatedAt"].as_u64()));
        values
    }

    pub fn save(&self, session: &Session) -> Result<()> {
        if !valid_session_id(&session.id) {
            bail!("invalid ND agent session id");
        }
        let dir = self.root.join(&session.id);
        fs::create_dir_all(&dir)?;
        let nonce = Uuid::new_v4();
        let name = format!("{:020}-{nonce}.json", now_ms());
        let temporary = dir.join(format!(".{name}.tmp"));
        let destination = dir.join(name);
        let bytes = serde_json::to_vec(session)?;
        fs::write(&temporary, bytes).context("write ND agent snapshot")?;
        fs::rename(&temporary, &destination).context("commit ND agent snapshot")?;
        let mut snapshots = snapshot_paths(&dir)?;
        snapshots.sort();
        for old in snapshots.iter().take(snapshots.len().saturating_sub(2)) {
            let _ = fs::remove_file(old);
        }
        Ok(())
    }
}

fn valid_session_id(id: &str) -> bool {
    id.starts_with("nd-native-")
        && id.len() < 100
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn snapshot_paths(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(fs::read_dir(dir)?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            (path.extension()?.to_str()? == "json").then_some(path)
        })
        .collect())
}

fn load_latest(dir: &Path) -> Result<Option<Session>> {
    let mut snapshots = snapshot_paths(dir)?;
    snapshots.sort();
    for path in snapshots.into_iter().rev() {
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        if let Ok(session) = serde_json::from_slice(&bytes) {
            return Ok(Some(session));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_recovers_without_replaying_interrupted_turn() {
        let temp = tempfile::tempdir().unwrap();
        let store = SessionStore::open(temp.path()).unwrap();
        let session = store.create("C:/project".to_owned()).unwrap();
        let id = session.lock().unwrap().id.clone();
        {
            let mut session = session.lock().unwrap();
            session.running = true;
            session.record("user/message", json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "hello" }] } }));
            store.save(&session).unwrap();
        }
        drop(store);
        let recovered = SessionStore::open(temp.path()).unwrap();
        let session = recovered.get(&id).unwrap();
        let session = session.lock().unwrap();
        assert!(!session.running);
        assert_eq!(session.events.last().unwrap()["type"], "agent/error");
    }
}
