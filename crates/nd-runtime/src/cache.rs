//! A small revision-keyed response cache.
//!
//! Every entry is stored under the revision marker that describes the state the
//! response was derived from. A read only hits when the marker still matches, so a
//! mutation outside nd-core invalidates the entry instead of serving stale data.
//! Entries report `cached` and `revision` in their payload, which is how the
//! benchmark and the caller tell a served response from a freshly computed one.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

pub const DEFAULT_MAX_ENTRIES: usize = 64;
pub const DEFAULT_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSnapshot {
    pub entries: usize,
    pub bytes: usize,
    pub max_entries: usize,
    pub max_bytes: usize,
    pub hits: u64,
    pub misses: u64,
    pub invalidations: u64,
    pub evictions: u64,
    pub inserts: u64,
}

struct Entry {
    revision: String,
    payload: Value,
    bytes: usize,
    used_at: u64,
}

#[derive(Default)]
struct CacheState {
    entries: HashMap<String, Entry>,
    bytes: usize,
    clock: u64,
    hits: u64,
    misses: u64,
    invalidations: u64,
    evictions: u64,
    inserts: u64,
}

pub struct ResponseCache {
    max_entries: usize,
    max_bytes: usize,
    state: Mutex<CacheState>,
}

impl ResponseCache {
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            max_entries: max_entries.max(1),
            max_bytes: max_bytes.max(1024),
            state: Mutex::new(CacheState::default()),
        }
    }

    /// Look a key up under `revision`. A key held under a different marker is
    /// dropped and reported as a miss, so the caller recomputes.
    pub fn get(&self, key: &str, revision: &str) -> Option<Value> {
        let Ok(mut state) = self.state.lock() else {
            return None;
        };
        state.clock += 1;
        let clock = state.clock;
        let Some(entry) = state.entries.get(key) else {
            state.misses += 1;
            return None;
        };
        if entry.revision != revision {
            let removed = state.entries.remove(key).expect("entry was just observed");
            state.bytes = state.bytes.saturating_sub(removed.bytes);
            state.invalidations += 1;
            state.misses += 1;
            return None;
        }
        let mut payload = entry.payload.clone();
        if let Some(entry) = state.entries.get_mut(key) {
            entry.used_at = clock;
        }
        state.hits += 1;
        annotate(&mut payload, revision, true);
        Some(payload)
    }

    pub fn put(&self, key: &str, revision: &str, payload: &Value) {
        let bytes = serde_json::to_vec(payload).map_or(0, |encoded| encoded.len());
        let mut payload = payload.clone();
        annotate(&mut payload, revision, false);
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.clock += 1;
        let clock = state.clock;
        if let Some(previous) = state.entries.remove(key) {
            state.bytes = state.bytes.saturating_sub(previous.bytes);
        }
        state.entries.insert(
            key.to_owned(),
            Entry {
                revision: revision.to_owned(),
                payload,
                bytes,
                used_at: clock,
            },
        );
        state.bytes = state.bytes.saturating_add(bytes);
        state.inserts += 1;
        evict(&mut state, self.max_entries, self.max_bytes);
    }

    pub fn snapshot(&self) -> CacheSnapshot {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        CacheSnapshot {
            entries: state.entries.len(),
            bytes: state.bytes,
            max_entries: self.max_entries,
            max_bytes: self.max_bytes,
            hits: state.hits,
            misses: state.misses,
            invalidations: state.invalidations,
            evictions: state.evictions,
            inserts: state.inserts,
        }
    }
}

/// Mark a payload with the revision it describes and whether it was served from the
/// cache, so staleness is never silent: a caller can always see both.
pub fn annotate(payload: &mut Value, revision: &str, cached: bool) {
    if let Some(object) = payload.as_object_mut() {
        object.insert("cached".to_owned(), Value::Bool(cached));
        object.insert("revision".to_owned(), Value::String(revision.to_owned()));
    }
}

fn evict(state: &mut CacheState, max_entries: usize, max_bytes: usize) {
    while state.entries.len() > max_entries || state.bytes > max_bytes {
        let Some(oldest_key) = state
            .entries
            .iter()
            .min_by_key(|(_, entry)| entry.used_at)
            .map(|(key, _)| key.clone())
        else {
            return;
        };
        if let Some(removed) = state.entries.remove(&oldest_key) {
            state.bytes = state.bytes.saturating_sub(removed.bytes);
            state.evictions += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_changed_revision_never_serves_the_previous_payload() {
        let cache = ResponseCache::new(8, 64 * 1024);
        let key = "git.status:/workspace";
        cache.put(key, "revision-a", &json!({ "entries": [] }));

        let hit = cache.get(key, "revision-a").expect("same revision hits");
        assert_eq!(hit["cached"], json!(true));
        assert_eq!(hit["revision"], json!("revision-a"));

        assert!(cache.get(key, "revision-b").is_none());
        let snapshot = cache.snapshot();
        assert_eq!(snapshot.invalidations, 1);
        assert_eq!(snapshot.entries, 0);
    }

    #[test]
    fn entry_count_and_bytes_stay_bounded_under_sustained_load() {
        let cache = ResponseCache::new(16, 4096);
        for index in 0..500 {
            cache.put(
                &format!("key-{index}"),
                "revision-a",
                &json!({ "index": index, "payload": "x".repeat(64) }),
            );
            let snapshot = cache.snapshot();
            assert!(snapshot.entries <= 16, "entry bound escaped at {index}");
            assert!(snapshot.bytes <= 4096, "byte bound escaped at {index}");
        }
        let snapshot = cache.snapshot();
        assert_eq!(snapshot.entries, 16);
        assert!(snapshot.evictions >= 484);
        assert_eq!(snapshot.inserts, 500);
    }

    #[test]
    fn hits_and_misses_are_counted_for_the_benchmark() {
        let cache = ResponseCache::new(4, 4096);
        cache.put("k", "r1", &json!({}));
        assert!(cache.get("k", "r1").is_some());
        assert!(cache.get("absent", "r1").is_none());
        let snapshot = cache.snapshot();
        assert_eq!(snapshot.hits, 1);
        assert_eq!(snapshot.misses, 1);
    }
}
