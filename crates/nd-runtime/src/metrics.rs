use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::sync::Mutex;

pub struct MetricsRegistry {
    workspace_roots: Mutex<HashSet<String>>,
}

impl Default for MetricsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl MetricsRegistry {
    pub fn new() -> Self {
        Self {
            workspace_roots: Mutex::new(HashSet::new()),
        }
    }

    pub fn observe_workspace(&self, root: &str) {
        let key = fs::canonicalize(root)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| root.to_owned());
        if let Ok(mut roots) = self.workspace_roots.lock() {
            roots.insert(key);
        }
    }

    pub fn workspace_count(&self) -> usize {
        self.workspace_roots
            .lock()
            .map(|roots| roots.len())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    pub metric: &'static str,
    pub bytes: Option<u64>,
}

pub fn current_process_memory() -> ProcessMemory {
    #[cfg(target_os = "linux")]
    {
        if let Ok(text) = fs::read_to_string("/proc/self/smaps_rollup")
            && let Some(value) = parse_kib_line(&text, "Pss:")
        {
            return ProcessMemory {
                metric: "pss",
                bytes: Some(value.saturating_mul(1024)),
            };
        }
        if let Ok(text) = fs::read_to_string("/proc/self/status")
            && let Some(value) = parse_kib_line(&text, "VmRSS:")
        {
            return ProcessMemory {
                metric: "rss",
                bytes: Some(value.saturating_mul(1024)),
            };
        }
    }

    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows_sys::Win32::System::ProcessStatus::{
            K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
        };
        use windows_sys::Win32::System::Threading::GetCurrentProcess;

        let mut counters = PROCESS_MEMORY_COUNTERS_EX::default();
        let ok = unsafe {
            K32GetProcessMemoryInfo(
                GetCurrentProcess(),
                (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX)
                    .cast::<PROCESS_MEMORY_COUNTERS>(),
                size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            )
        };
        if ok != 0 {
            return ProcessMemory {
                metric: "private-bytes",
                bytes: Some(counters.PrivateUsage as u64),
            };
        }
    }

    ProcessMemory {
        metric: "unavailable",
        bytes: None,
    }
}

#[cfg(target_os = "linux")]
fn parse_kib_line(text: &str, prefix: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let value = line.strip_prefix(prefix)?.trim();
        value.split_whitespace().next()?.parse::<u64>().ok()
    })
}
