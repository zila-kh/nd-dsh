//! Distinguishable protocol error codes.
//!
//! Every failure that leaves this process carries one of these codes on the wire.
//! Callers branch on the code rather than matching message text, so a message can
//! be reworded without changing control flow in TypeScript.

use anyhow::Error;
use std::fmt;

pub const CODE_METHOD_FAILED: &str = "method_failed";
pub const CODE_DEADLINE_EXCEEDED: &str = "deadline_exceeded";
pub const CODE_CANCELED: &str = "canceled";
pub const CODE_INVALID_PARAMS: &str = "invalid_params";
pub const CODE_RUNTIME_BUSY: &str = "runtime_busy";
pub const CODE_NOT_FOUND: &str = "not_found";

#[derive(Debug)]
pub struct CodedError {
    code: &'static str,
    message: String,
}

impl CodedError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for CodedError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CodedError {}

pub fn coded(code: &'static str, message: impl Into<String>) -> Error {
    Error::new(CodedError::new(code, message))
}

/// The code of the first [`CodedError`] in the chain, or `method_failed`.
pub fn code_of(error: &Error) -> &'static str {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<CodedError>().map(CodedError::code))
        .unwrap_or(CODE_METHOD_FAILED)
}

pub fn not_found(kind: &str, id: &str) -> Error {
    coded(CODE_NOT_FOUND, format!("{kind} not found: {id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_survives_context_wrapping() {
        let error = coded(CODE_DEADLINE_EXCEEDED, "git.exec exceeded its deadline")
            .context("Git command failed");
        assert_eq!(code_of(&error), CODE_DEADLINE_EXCEEDED);
    }

    #[test]
    fn uncoded_errors_default_to_method_failed() {
        let error = anyhow::anyhow!("something else went wrong");
        assert_eq!(code_of(&error), CODE_METHOD_FAILED);
    }
}
