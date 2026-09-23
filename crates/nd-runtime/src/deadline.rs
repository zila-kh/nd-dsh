//! Core-side deadlines and per-request cancellation.
//!
//! Before this module every timeout was client-side: when the TypeScript caller gave
//! up, the Rust work kept running — including a `git.exec` still mutating a worktree
//! that the next attempt was about to read. A request now carries an [`Interrupt`]
//! that both the client-visible deadline and `core.cancel` feed, and every
//! long-running operation observes it.

use crate::errors::{CODE_CANCELED, CODE_DEADLINE_EXCEEDED, coded};
use crate::scheduler::now_ms;
use anyhow::{Result, bail};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Shortest deadline a caller may request. Below this the value is almost certainly
/// a unit mistake (seconds sent as milliseconds).
pub const MIN_DEADLINE_MS: u64 = 50;
/// Longest deadline a caller may request. A request that outlives this is a hang,
/// not work, and must fail visibly rather than pin a dispatcher worker forever.
pub const MAX_DEADLINE_MS: u64 = 30 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Deadline {
    expires_at: u64,
}

impl Deadline {
    /// Validate a caller-supplied deadline and anchor it to now.
    pub fn from_ms(deadline_ms: u64) -> Result<Self> {
        if !(MIN_DEADLINE_MS..=MAX_DEADLINE_MS).contains(&deadline_ms) {
            bail!(
                "deadlineMs must be between {MIN_DEADLINE_MS} and {MAX_DEADLINE_MS} milliseconds, received {deadline_ms}"
            );
        }
        Ok(Self {
            expires_at: now_ms().saturating_add(deadline_ms),
        })
    }

    pub fn from_option(deadline_ms: Option<u64>) -> Result<Option<Self>> {
        deadline_ms.map(Self::from_ms).transpose()
    }

    pub fn expired(&self) -> bool {
        now_ms() >= self.expires_at
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    Canceled,
    DeadlineExceeded,
}

impl StopReason {
    pub fn code(self) -> &'static str {
        match self {
            Self::Canceled => CODE_CANCELED,
            Self::DeadlineExceeded => CODE_DEADLINE_EXCEEDED,
        }
    }
}

/// The cancellation/deadline state of one in-flight request.
#[derive(Debug, Clone)]
pub struct Interrupt {
    canceled: Arc<AtomicBool>,
    deadline: Option<Deadline>,
}

impl Interrupt {
    #[cfg(test)]
    pub fn never() -> Self {
        Self {
            canceled: Arc::new(AtomicBool::new(false)),
            deadline: None,
        }
    }

    pub fn new(canceled: Arc<AtomicBool>, deadline: Option<Deadline>) -> Self {
        Self { canceled, deadline }
    }

    pub fn stop_reason(&self) -> Option<StopReason> {
        if self.canceled.load(Ordering::Relaxed) {
            return Some(StopReason::Canceled);
        }
        if self.deadline.is_some_and(|deadline| deadline.expired()) {
            return Some(StopReason::DeadlineExceeded);
        }
        None
    }

    /// Fail with the distinguishable code when the request must stop.
    pub fn check(&self, operation: &str) -> Result<()> {
        match self.stop_reason() {
            Some(StopReason::Canceled) => Err(coded(
                CODE_CANCELED,
                format!("{operation} was canceled by the caller"),
            )),
            Some(StopReason::DeadlineExceeded) => Err(coded(
                CODE_DEADLINE_EXCEEDED,
                format!("{operation} exceeded its core deadline"),
            )),
            None => Ok(()),
        }
    }

    /// How long a long-running operation may sleep before it must re-check this
    /// interrupt. Short enough that a deadline is honoured promptly, and shortened
    /// further as the deadline approaches so expiry is not missed by a full slice.
    pub fn poll_slice(&self) -> Duration {
        const OPERATION_POLL_MS: u64 = 10;
        let slice = self.deadline.map_or(OPERATION_POLL_MS, |deadline| {
            OPERATION_POLL_MS.min(deadline.expires_at.saturating_sub(now_ms()))
        });
        Duration::from_millis(slice.max(1))
    }
}

/// In-flight request interrupts, addressed by protocol request id.
///
/// Entries are registered when a request is accepted — before it reaches a
/// dispatcher worker, so a request that expires in the queue fails immediately
/// instead of running late — and removed by [`InterruptRegistry::finish`].
#[derive(Default)]
pub struct InterruptRegistry {
    entries: Mutex<HashMap<String, Interrupt>>,
}

impl InterruptRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, request_id: &str, deadline: Option<Deadline>) -> Interrupt {
        let interrupt = Interrupt::new(Arc::new(AtomicBool::new(false)), deadline);
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(request_id.to_owned(), interrupt.clone());
        }
        interrupt
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(request_id);
        }
    }

    /// Ask one request to stop. Returns whether it was still in flight.
    pub fn cancel(&self, request_id: &str) -> bool {
        let entry = self
            .entries
            .lock()
            .ok()
            .and_then(|entries| entries.get(request_id).cloned());
        match entry {
            Some(interrupt) => {
                interrupt.canceled.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }

    pub fn cancel_all(&self) -> usize {
        let entries = self
            .entries
            .lock()
            .map(|entries| entries.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for interrupt in &entries {
            interrupt.canceled.store(true, Ordering::Relaxed);
        }
        entries.len()
    }

    pub fn active_count(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or_default()
    }
}

/// Releases the registry entry when the owning dispatch job leaves scope, whatever
/// path it leaves by.
pub struct InterruptGuard {
    registry: Arc<InterruptRegistry>,
    request_id: String,
}

impl InterruptGuard {
    pub fn new(registry: Arc<InterruptRegistry>, request_id: String) -> Self {
        Self {
            registry,
            request_id,
        }
    }
}

impl Drop for InterruptGuard {
    fn drop(&mut self) {
        self.registry.finish(&self.request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_absurd_deadlines() {
        assert!(Deadline::from_ms(0).is_err());
        assert!(Deadline::from_ms(MIN_DEADLINE_MS - 1).is_err());
        assert!(Deadline::from_ms(MAX_DEADLINE_MS + 1).is_err());
        assert!(Deadline::from_ms(u64::MAX).is_err());
        assert!(Deadline::from_ms(MIN_DEADLINE_MS).is_ok());
        assert!(Deadline::from_ms(MAX_DEADLINE_MS).is_ok());
        assert!(Deadline::from_option(None).unwrap().is_none());
    }

    #[test]
    fn expired_deadline_reports_its_distinguishable_code() {
        let deadline = Deadline::from_ms(MIN_DEADLINE_MS).unwrap();
        let interrupt = Interrupt::new(Arc::new(AtomicBool::new(false)), Some(deadline));
        std::thread::sleep(Duration::from_millis(MIN_DEADLINE_MS + 20));
        assert_eq!(interrupt.stop_reason(), Some(StopReason::DeadlineExceeded));
        let error = interrupt.check("git.exec").unwrap_err();
        assert_eq!(crate::errors::code_of(&error), CODE_DEADLINE_EXCEEDED);
    }

    #[test]
    fn canceling_one_request_leaves_its_peers_untouched() {
        let registry = InterruptRegistry::new();
        let first = registry.register("request-a", Some(Deadline::from_ms(5_000).unwrap()));
        let second = registry.register("request-b", Some(Deadline::from_ms(5_000).unwrap()));

        assert!(registry.cancel("request-a"));
        assert_eq!(first.stop_reason(), Some(StopReason::Canceled));
        assert_eq!(second.stop_reason(), None);
        assert!(second.check("git.exec").is_ok());
        assert_eq!(registry.active_count(), 2);

        registry.finish("request-a");
        assert_eq!(registry.active_count(), 1);
        assert!(!registry.cancel("request-a"));
        // A request that already finished is no longer cancellable, and its peer
        // keeps running under its own deadline.
        assert_eq!(second.stop_reason(), None);
        registry.finish("request-b");
        assert_eq!(registry.active_count(), 0);
    }

    #[test]
    fn deadline_is_anchored_to_registration_not_to_check_time() {
        let registry = InterruptRegistry::new();
        let deadline = Deadline::from_ms(MIN_DEADLINE_MS).unwrap();
        let interrupt = registry.register("request-c", Some(deadline));
        let error = Deadline::from_ms(MAX_DEADLINE_MS + 1).unwrap_err();
        assert!(error.to_string().contains("deadlineMs must be between"));
        assert!(interrupt.poll_slice() <= Duration::from_millis(10));
        assert_eq!(interrupt.stop_reason(), None);
    }
}
