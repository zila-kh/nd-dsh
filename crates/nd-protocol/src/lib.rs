//! Rust-owned ND core wire contract.
//!
//! This crate intentionally contains no runtime implementation. Electron and
//! nd-runtime both depend on this boundary so protocol drift cannot hide inside
//! the composition binary.

pub mod errors;
mod wire;

pub use wire::{
    MAX_FRAME_BYTES, PROTOCOL_VERSION, ProtocolQueueSnapshot, ProtocolWriter, RequestFrame,
    WireError, read_request,
};

#[cfg(test)]
mod contract_parity {
    use super::*;

    const TYPESCRIPT_CONTRACT: &str =
        include_str!("../../../src/main/core/core-protocol.ts");

    #[test]
    fn typescript_protocol_constants_match_rust_source_of_truth() {
        assert!(TYPESCRIPT_CONTRACT.contains(&format!(
            "export const ND_CORE_PROTOCOL_VERSION = {PROTOCOL_VERSION}"
        )));
        assert!(TYPESCRIPT_CONTRACT.contains(&format!(
            "export const ND_CORE_MAX_FRAME_BYTES = {} * 1024 * 1024",
            MAX_FRAME_BYTES / 1024 / 1024
        )));
    }

    #[test]
    fn typescript_error_vocabulary_matches_rust() {
        for code in [
            errors::CODE_METHOD_FAILED,
            errors::CODE_DEADLINE_EXCEEDED,
            errors::CODE_CANCELED,
            errors::CODE_INVALID_PARAMS,
            errors::CODE_RUNTIME_BUSY,
            errors::CODE_NOT_FOUND,
        ] {
            assert!(
                TYPESCRIPT_CONTRACT.contains(code),
                "TypeScript core protocol is missing Rust error code {code}"
            );
        }
    }
}
