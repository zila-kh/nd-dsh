use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

pub const DEFAULT_MAX_EVENTS_PER_SESSION: usize = 10_000;
pub const DEFAULT_MAX_BYTES_PER_SESSION: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionJournalEnvelope {
    #[serde(rename = "type")]
    pub event_type: String,
    pub seq: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionJournalAppendParams {
    pub session_id: String,
    #[serde(default)]
    pub events: Vec<SessionJournalEnvelope>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionJournalSessionParams {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionJournalTailParams {
    pub session_id: String,
    #[serde(default = "default_tail_limit")]
    pub max_messages: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionJournalTailResult {
    pub events: Vec<SessionJournalEnvelope>,
    pub retained_events: usize,
    pub retained_bytes: usize,
    pub first_seq: Option<u64>,
    pub last_seq: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionJournalStats {
    pub session_count: usize,
    pub retained_event_count: usize,
    pub retained_bytes: usize,
    pub max_events_per_session: usize,
    pub max_bytes_per_session: usize,
}

struct StoredEnvelope {
    envelope: SessionJournalEnvelope,
    bytes: usize,
}

#[derive(Default)]
struct SessionJournal {
    events: VecDeque<StoredEnvelope>,
    bytes: usize,
}

pub struct SessionJournalStore {
    sessions: Mutex<HashMap<String, SessionJournal>>,
    max_events_per_session: usize,
    max_bytes_per_session: usize,
}

impl SessionJournalStore {
    pub fn new(max_events_per_session: usize, max_bytes_per_session: usize) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            max_events_per_session: max_events_per_session.max(1),
            max_bytes_per_session: max_bytes_per_session.max(1024),
        }
    }

    pub fn append(&self, params: SessionJournalAppendParams) -> Result<SessionJournalTailResult> {
        validate_session_id(&params.session_id)?;
        if params.events.len() > 1024 {
            bail!("session journal append batch is too large");
        }
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("session journal lock poisoned"))?;
        let journal = sessions.entry(params.session_id).or_default();
        for envelope in params.events {
            validate_envelope(&envelope)?;
            let encoded_bytes = serde_json::to_vec(&envelope)
                .map(|value| value.len())
                .unwrap_or_default();
            journal.bytes = journal.bytes.saturating_add(encoded_bytes);
            journal.events.push_back(StoredEnvelope {
                envelope,
                bytes: encoded_bytes,
            });
            trim_journal(
                journal,
                self.max_events_per_session,
                self.max_bytes_per_session,
            );
        }
        Ok(tail_result(journal, self.max_events_per_session))
    }

    pub fn reset(&self, params: SessionJournalSessionParams) -> Result<bool> {
        validate_session_id(&params.session_id)?;
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("session journal lock poisoned"))?;
        Ok(sessions.remove(&params.session_id).is_some())
    }

    pub fn drop_session(&self, params: SessionJournalSessionParams) -> Result<bool> {
        self.reset(params)
    }

    pub fn clear(&self) -> Result<usize> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("session journal lock poisoned"))?;
        let count = sessions.len();
        sessions.clear();
        Ok(count)
    }

    pub fn tail(&self, params: SessionJournalTailParams) -> Result<SessionJournalTailResult> {
        validate_session_id(&params.session_id)?;
        let limit = params.max_messages.clamp(1, self.max_events_per_session);
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow::anyhow!("session journal lock poisoned"))?;
        let Some(journal) = sessions.get(&params.session_id) else {
            return Ok(SessionJournalTailResult {
                events: Vec::new(),
                retained_events: 0,
                retained_bytes: 0,
                first_seq: None,
                last_seq: None,
            });
        };
        Ok(tail_result(journal, limit))
    }

    pub fn stats(&self) -> SessionJournalStats {
        let sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        SessionJournalStats {
            session_count: sessions.len(),
            retained_event_count: sessions.values().map(|journal| journal.events.len()).sum(),
            retained_bytes: sessions.values().map(|journal| journal.bytes).sum(),
            max_events_per_session: self.max_events_per_session,
            max_bytes_per_session: self.max_bytes_per_session,
        }
    }
}

fn tail_result(journal: &SessionJournal, limit: usize) -> SessionJournalTailResult {
    let skip = journal.events.len().saturating_sub(limit);
    let events = journal
        .events
        .iter()
        .skip(skip)
        .map(|stored| stored.envelope.clone())
        .collect::<Vec<_>>();
    SessionJournalTailResult {
        first_seq: journal.events.front().map(|stored| stored.envelope.seq),
        last_seq: journal.events.back().map(|stored| stored.envelope.seq),
        retained_events: journal.events.len(),
        retained_bytes: journal.bytes,
        events,
    }
}

fn trim_journal(journal: &mut SessionJournal, max_events: usize, max_bytes: usize) {
    while journal.events.len() > max_events || journal.bytes > max_bytes {
        let Some(removed) = journal.events.pop_front() else {
            break;
        };
        journal.bytes = journal.bytes.saturating_sub(removed.bytes);
    }
}

fn validate_session_id(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 {
        bail!("invalid session journal id");
    }
    Ok(())
}

fn validate_envelope(envelope: &SessionJournalEnvelope) -> Result<()> {
    if envelope.event_type.trim().is_empty() || envelope.event_type.len() > 256 {
        bail!("invalid session journal event type");
    }
    Ok(())
}

fn default_tail_limit() -> usize {
    50
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(seq: u64, text: &str) -> SessionJournalEnvelope {
        SessionJournalEnvelope {
            event_type: "assistant/message".into(),
            seq,
            time: Some(seq),
            data: Some(serde_json::json!({ "text": text })),
        }
    }

    #[test]
    fn retains_only_the_newest_event_window() {
        let store = SessionJournalStore::new(3, 1024 * 1024);
        store
            .append(SessionJournalAppendParams {
                session_id: "s1".into(),
                events: (1..=5).map(|seq| envelope(seq, "x")).collect(),
            })
            .unwrap();
        let tail = store
            .tail(SessionJournalTailParams {
                session_id: "s1".into(),
                max_messages: 10,
            })
            .unwrap();
        assert_eq!(tail.events.iter().map(|event| event.seq).collect::<Vec<_>>(), vec![3, 4, 5]);
        assert_eq!(tail.first_seq, Some(3));
        assert_eq!(tail.last_seq, Some(5));
    }

    #[test]
    fn retained_bytes_are_bounded() {
        let store = SessionJournalStore::new(100, 256);
        store
            .append(SessionJournalAppendParams {
                session_id: "s1".into(),
                events: (1..=20).map(|seq| envelope(seq, "0123456789abcdef")).collect(),
            })
            .unwrap();
        let stats = store.stats();
        assert!(stats.retained_bytes <= 256);
        assert!(stats.retained_event_count < 20);
    }

    #[test]
    fn reset_drops_only_one_session() {
        let store = SessionJournalStore::new(10, 1024);
        for id in ["a", "b"] {
            store
                .append(SessionJournalAppendParams {
                    session_id: id.into(),
                    events: vec![envelope(1, id)],
                })
                .unwrap();
        }
        assert!(store.reset(SessionJournalSessionParams { session_id: "a".into() }).unwrap());
        assert_eq!(store.stats().session_count, 1);
        assert_eq!(store.tail(SessionJournalTailParams { session_id: "b".into(), max_messages: 5 }).unwrap().events.len(), 1);
    }
}
