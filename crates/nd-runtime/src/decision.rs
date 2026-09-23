use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DecisionSupportMode {
    Off,
    Shadow,
    Assist,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DecisionAnswer {
    Choice {
        choice: String,
        #[serde(default)]
        confidence: Option<f64>,
        #[serde(default)]
        probabilities: Option<HashMap<String, f64>>,
    },
    Score {
        score: f64,
        #[serde(default)]
        confidence: Option<f64>,
        #[serde(default)]
        probabilities: Option<HashMap<String, f64>>,
    },
    Noul {
        noul: f64,
        #[serde(default)]
        confidence: Option<f64>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionProviderResult {
    pub provider: String,
    pub model: String,
    pub answers: HashMap<String, DecisionAnswer>,
    pub latency_ms: u64,
    pub minimum_confidence: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionProviderAttempt {
    pub provider: String,
    pub ok: bool,
    #[serde(default)]
    pub result: Option<DecisionProviderResult>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionEvaluateParams {
    pub purpose: String,
    pub mode: DecisionSupportMode,
    pub threshold: f64,
    pub provider_count: usize,
    #[serde(default)]
    pub attempts: Vec<DecisionProviderAttempt>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionReceipt {
    pub purpose: String,
    pub mode: DecisionSupportMode,
    pub threshold: f64,
    pub attempts: Vec<DecisionProviderAttempt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_provider: Option<String>,
    pub escalated: bool,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionEvaluateResult {
    pub receipt: DecisionReceipt,
    pub should_continue: bool,
}

pub fn evaluate(params: DecisionEvaluateParams) -> Result<DecisionEvaluateResult> {
    validate(&params)?;
    let mut selected_provider = None;
    if params.mode == DecisionSupportMode::Assist {
        for attempt in &params.attempts {
            if !attempt.ok {
                continue;
            }
            let Some(result) = attempt.result.as_ref() else {
                continue;
            };
            if result.minimum_confidence >= params.threshold {
                selected_provider = Some(attempt.provider.clone());
                break;
            }
        }
    }

    let attempted = params.attempts.len();
    let should_continue = match params.mode {
        DecisionSupportMode::Off => false,
        DecisionSupportMode::Shadow => attempted < params.provider_count,
        DecisionSupportMode::Assist => {
            selected_provider.is_none() && attempted < params.provider_count
        }
    };
    let escalated = params.mode == DecisionSupportMode::Assist
        && (attempted > 1
            || (attempted == 1 && selected_provider.is_none() && params.provider_count > 1));

    Ok(DecisionEvaluateResult {
        receipt: DecisionReceipt {
            purpose: params.purpose,
            mode: params.mode,
            threshold: params.threshold,
            attempts: params.attempts,
            selected_provider,
            escalated,
            created_at: now_ms(),
        },
        should_continue,
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn validate(params: &DecisionEvaluateParams) -> Result<()> {
    if params.purpose.trim().is_empty() || params.purpose.len() > 128 {
        bail!("invalid decision purpose");
    }
    if !params.threshold.is_finite() || !(0.0..=1.0).contains(&params.threshold) {
        bail!("decision threshold must be between 0 and 1");
    }
    if params.provider_count > 16 {
        bail!("decision provider count exceeds 16");
    }
    if params.attempts.len() > params.provider_count {
        bail!("decision attempts exceed provider count");
    }
    for attempt in &params.attempts {
        if attempt.provider.trim().is_empty() || attempt.provider.len() > 128 {
            bail!("invalid decision provider");
        }
        if attempt.ok != attempt.result.is_some() {
            bail!("successful decision attempt must include result and failed attempt must not");
        }
        if let Some(result) = attempt.result.as_ref() {
            if result.provider != attempt.provider {
                bail!("decision provider result identity mismatch");
            }
            if result.model.trim().is_empty() || result.model.len() > 256 {
                bail!("invalid decision model");
            }
            if !result.minimum_confidence.is_finite()
                || !(0.0..=1.0).contains(&result.minimum_confidence)
            {
                bail!("invalid decision confidence");
            }
            for answer in result.answers.values() {
                validate_answer(answer)?;
            }
        }
    }
    Ok(())
}

fn validate_answer(answer: &DecisionAnswer) -> Result<()> {
    let confidence = match answer {
        DecisionAnswer::Choice {
            choice,
            confidence,
            probabilities,
        } => {
            if choice.trim().is_empty() || choice.len() > 256 {
                bail!("invalid decision choice");
            }
            validate_probabilities(probabilities.as_ref())?;
            *confidence
        }
        DecisionAnswer::Score {
            score,
            confidence,
            probabilities,
        } => {
            if !score.is_finite() {
                bail!("invalid decision score");
            }
            validate_probabilities(probabilities.as_ref())?;
            *confidence
        }
        DecisionAnswer::Noul { noul, confidence } => {
            if !noul.is_finite() || !(0.0..=1.0).contains(noul) {
                bail!("invalid decision noul probability");
            }
            *confidence
        }
    };
    if let Some(confidence) = confidence
        && (!confidence.is_finite() || !(0.0..=1.0).contains(&confidence))
    {
        bail!("invalid answer confidence");
    }
    Ok(())
}

fn validate_probabilities(probabilities: Option<&HashMap<String, f64>>) -> Result<()> {
    if let Some(probabilities) = probabilities {
        if probabilities.len() > 256 {
            bail!("too many decision probabilities");
        }
        for (key, value) in probabilities {
            if key.trim().is_empty() || key.len() > 256 {
                bail!("invalid probability label");
            }
            if !value.is_finite() || !(0.0..=1.0).contains(value) {
                bail!("invalid decision probability");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt(provider: &str, confidence: f64) -> DecisionProviderAttempt {
        DecisionProviderAttempt {
            provider: provider.into(),
            ok: true,
            result: Some(DecisionProviderResult {
                provider: provider.into(),
                model: format!("{provider}-model"),
                answers: HashMap::from([(
                    "route".into(),
                    DecisionAnswer::Choice {
                        choice: "standard".into(),
                        confidence: Some(confidence),
                        probabilities: None,
                    },
                )]),
                latency_ms: 1,
                minimum_confidence: confidence,
            }),
            error: None,
        }
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityCase {
        name: String,
        mode: DecisionSupportMode,
        threshold: f64,
        provider_count: usize,
        attempts: Vec<DecisionProviderAttempt>,
        expected: ParityExpected,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityExpected {
        selected_provider: Option<String>,
        should_continue: bool,
        escalated: bool,
    }

    #[test]
    fn shared_fixture_corpus_matches_rust_kernel() {
        let cases: Vec<ParityCase> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/decision-kernel-parity.json"
        ))
        .unwrap();
        for case in cases {
            let result = evaluate(DecisionEvaluateParams {
                purpose: "review-assist".into(),
                mode: case.mode,
                threshold: case.threshold,
                provider_count: case.provider_count,
                attempts: case.attempts,
            })
            .unwrap_or_else(|error| panic!("{}: {error:#}", case.name));
            assert_eq!(
                result.receipt.selected_provider, case.expected.selected_provider,
                "{} selected provider",
                case.name
            );
            assert_eq!(
                result.should_continue, case.expected.should_continue,
                "{} continuation",
                case.name
            );
            assert_eq!(
                result.receipt.escalated, case.expected.escalated,
                "{} escalation",
                case.name
            );
        }
    }

    #[test]
    fn high_confidence_first_provider_stops_assist_cascade() {
        let result = evaluate(DecisionEvaluateParams {
            purpose: "review-assist".into(),
            mode: DecisionSupportMode::Assist,
            threshold: 0.78,
            provider_count: 2,
            attempts: vec![attempt("laya", 0.92)],
        })
        .unwrap();
        assert_eq!(result.receipt.selected_provider.as_deref(), Some("laya"));
        assert!(!result.should_continue);
        assert!(!result.receipt.escalated);
    }

    #[test]
    fn low_confidence_first_provider_requests_escalation() {
        let result = evaluate(DecisionEvaluateParams {
            purpose: "review-assist".into(),
            mode: DecisionSupportMode::Assist,
            threshold: 0.78,
            provider_count: 2,
            attempts: vec![attempt("laya", 0.51)],
        })
        .unwrap();
        assert_eq!(result.receipt.selected_provider, None);
        assert!(result.should_continue);
        assert!(result.receipt.escalated);
    }

    #[test]
    fn all_low_confidence_falls_back_without_selection() {
        let result = evaluate(DecisionEvaluateParams {
            purpose: "review-assist".into(),
            mode: DecisionSupportMode::Assist,
            threshold: 0.78,
            provider_count: 2,
            attempts: vec![attempt("laya", 0.51), attempt("jev", 0.62)],
        })
        .unwrap();
        assert_eq!(result.receipt.selected_provider, None);
        assert!(!result.should_continue);
        assert!(result.receipt.escalated);
    }

    #[test]
    fn shadow_mode_never_selects_and_collects_all_providers() {
        let result = evaluate(DecisionEvaluateParams {
            purpose: "review-assist".into(),
            mode: DecisionSupportMode::Shadow,
            threshold: 0.78,
            provider_count: 2,
            attempts: vec![attempt("laya", 0.95)],
        })
        .unwrap();
        assert_eq!(result.receipt.selected_provider, None);
        assert!(result.should_continue);
        assert!(!result.receipt.escalated);
    }
}
