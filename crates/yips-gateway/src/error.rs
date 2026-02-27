//! Error types for gateway operations.

use thiserror::Error;

/// Result type for gateway operations.
pub type Result<T> = std::result::Result<T, GatewayError>;

/// Errors produced by gateway runtime and daemon IPC wrapper.
#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("IPC error: {0}")]
    Ipc(#[from] yips_core::error::YipsError),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Adapter error: {0}")]
    Adapter(String),

    #[error("Daemon returned error: {0}")]
    Daemon(String),
}
