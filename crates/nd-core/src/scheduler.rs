use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolClaim {
    pub key: String,
    pub limit: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireParams {
    pub permit_id: Option<String>,
    pub company_id: Option<String>,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub kind: String,
    pub pools: Vec<PoolClaim>,
    pub ttl_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatParams {
    pub permit_id: String,
    pub ttl_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseParams {
    pub permit_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindParams {
    pub permit_id: String,
    pub session_id: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermitRecord {
    pub id: String,
    pub company_id: Option<String>,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub kind: String,
    pub pools: Vec<PoolClaim>,
    pub acquired_at: u64,
    pub heartbeat_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireResult {
    pub granted: bool,
    pub reason: Option<String>,
    pub permit: Option<PermitRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerSnapshot {
    pub permits: Vec<PermitRecord>,
    pub pools: HashMap<String, u32>,
}

pub struct Scheduler {
    permits: Mutex<HashMap<String, PermitRecord>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            permits: Mutex::new(HashMap::new()),
        }
    }

    pub fn acquire(&self, params: AcquireParams) -> Result<AcquireResult> {
        validate_id_opt(params.company_id.as_deref())?;
        validate_id_opt(params.project_id.as_deref())?;
        validate_id_opt(params.task_id.as_deref())?;
        validate_id_opt(params.run_id.as_deref())?;
        validate_id_opt(params.session_id.as_deref())?;
        validate_id_opt(params.agent_id.as_deref())?;
        if params.kind.is_empty() || params.kind.len() > 64 {
            bail!("invalid permit kind");
        }
        if params.pools.is_empty() || params.pools.len() > 16 {
            bail!("a permit must request between 1 and 16 pools");
        }

        let mut unique = HashSet::new();
        for pool in &params.pools {
            if pool.key.is_empty() || pool.key.len() > 512 {
                bail!("invalid pool key");
            }
            if pool.limit == 0 || pool.limit > 1024 {
                bail!("pool limit must be between 1 and 1024");
            }
            if !unique.insert(pool.key.clone()) {
                bail!("duplicate pool key");
            }
        }

        let now = now_ms();
        let ttl = params.ttl_ms.unwrap_or(120_000).clamp(5_000, 3_600_000);
        let id = params
            .permit_id
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        validate_id(&id)?;

        let mut permits = self
            .permits
            .lock()
            .map_err(|_| anyhow::anyhow!("scheduler lock poisoned"))?;
        expire_locked(&mut permits, now);

        if permits.contains_key(&id) {
            bail!("permit id already exists");
        }

        for claim in &params.pools {
            let used = permits
                .values()
                .filter(|permit| permit.pools.iter().any(|pool| pool.key == claim.key))
                .count() as u32;
            if used >= claim.limit {
                return Ok(AcquireResult {
                    granted: false,
                    reason: Some(format!(
                        "runtime pool {} is full ({used}/{})",
                        claim.key, claim.limit
                    )),
                    permit: None,
                });
            }
        }

        let permit = PermitRecord {
            id: id.clone(),
            company_id: params.company_id,
            project_id: params.project_id,
            task_id: params.task_id,
            run_id: params.run_id,
            session_id: params.session_id,
            agent_id: params.agent_id,
            kind: params.kind,
            pools: params.pools,
            acquired_at: now,
            heartbeat_at: now,
            expires_at: now.saturating_add(ttl),
        };
        permits.insert(id, permit.clone());

        Ok(AcquireResult {
            granted: true,
            reason: None,
            permit: Some(permit),
        })
    }

    pub fn heartbeat(&self, params: HeartbeatParams) -> Result<PermitRecord> {
        validate_id(&params.permit_id)?;
        let now = now_ms();
        let ttl = params.ttl_ms.unwrap_or(120_000).clamp(5_000, 3_600_000);
        let mut permits = self
            .permits
            .lock()
            .map_err(|_| anyhow::anyhow!("scheduler lock poisoned"))?;
        expire_locked(&mut permits, now);
        let permit = permits
            .get_mut(&params.permit_id)
            .ok_or_else(|| anyhow::anyhow!("runtime permit not found"))?;
        permit.heartbeat_at = now;
        permit.expires_at = now.saturating_add(ttl);
        Ok(permit.clone())
    }

    pub fn bind(&self, params: BindParams) -> Result<PermitRecord> {
        validate_id(&params.permit_id)?;
        validate_id(&params.session_id)?;
        validate_id_opt(params.run_id.as_deref())?;
        let now = now_ms();
        let mut permits = self
            .permits
            .lock()
            .map_err(|_| anyhow::anyhow!("scheduler lock poisoned"))?;
        expire_locked(&mut permits, now);
        let permit = permits
            .get_mut(&params.permit_id)
            .ok_or_else(|| anyhow::anyhow!("runtime permit not found"))?;
        permit.session_id = Some(params.session_id);
        if params.run_id.is_some() {
            permit.run_id = params.run_id;
        }
        Ok(permit.clone())
    }

    pub fn release(&self, params: ReleaseParams) -> Result<bool> {
        validate_id(&params.permit_id)?;
        let mut permits = self
            .permits
            .lock()
            .map_err(|_| anyhow::anyhow!("scheduler lock poisoned"))?;
        Ok(permits.remove(&params.permit_id).is_some())
    }

    pub fn has_permit(&self, id: &str) -> bool {
        let now = now_ms();
        let Ok(mut permits) = self.permits.lock() else {
            return false;
        };
        expire_locked(&mut permits, now);
        permits.contains_key(id)
    }

    pub fn snapshot(&self) -> Result<SchedulerSnapshot> {
        let now = now_ms();
        let mut permits = self
            .permits
            .lock()
            .map_err(|_| anyhow::anyhow!("scheduler lock poisoned"))?;
        expire_locked(&mut permits, now);
        let mut pools = HashMap::new();
        for permit in permits.values() {
            for pool in &permit.pools {
                *pools.entry(pool.key.clone()).or_insert(0) += 1;
            }
        }
        let mut records = permits.values().cloned().collect::<Vec<_>>();
        records.sort_by_key(|item| item.acquired_at);
        Ok(SchedulerSnapshot {
            permits: records,
            pools,
        })
    }
}

fn expire_locked(permits: &mut HashMap<String, PermitRecord>, now: u64) {
    permits.retain(|_, permit| permit.expires_at > now);
}

fn validate_id(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 {
        bail!("invalid resource id");
    }
    Ok(())
}

fn validate_id_opt(value: Option<&str>) -> Result<()> {
    if let Some(value) = value {
        validate_id(value)?;
    }
    Ok(())
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_is_atomic_across_pools() {
        let scheduler = Scheduler::new();
        let first = scheduler
            .acquire(AcquireParams {
                permit_id: Some("a".into()),
                company_id: None,
                project_id: None,
                task_id: None,
                run_id: None,
                session_id: None,
                agent_id: None,
                kind: "execution".into(),
                pools: vec![
                    PoolClaim {
                        key: "project:p:execution".into(),
                        limit: 2,
                    },
                    PoolClaim {
                        key: "role:r".into(),
                        limit: 1,
                    },
                ],
                ttl_ms: None,
            })
            .unwrap();
        assert!(first.granted);

        let second = scheduler
            .acquire(AcquireParams {
                permit_id: Some("b".into()),
                company_id: None,
                project_id: None,
                task_id: None,
                run_id: None,
                session_id: None,
                agent_id: None,
                kind: "execution".into(),
                pools: vec![
                    PoolClaim {
                        key: "project:p:execution".into(),
                        limit: 2,
                    },
                    PoolClaim {
                        key: "role:r".into(),
                        limit: 1,
                    },
                ],
                ttl_ms: None,
            })
            .unwrap();
        assert!(!second.granted);
        assert_eq!(scheduler.snapshot().unwrap().permits.len(), 1);
    }
}
