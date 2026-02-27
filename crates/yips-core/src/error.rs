//! Error types shared across the Yips workspace.

use thiserror::Error;

/// Top-level error type for Yips operations.
#[derive(Debug, Error)]
pub enum YipsError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("IPC error: {0}")]
    Ipc(String),

    #[error("LLM error: {0}")]
    Llm(String),

    #[error("Tool error: {0}")]
    Tool(String),

    #[error("Skill error: {0}")]
    Skill(String),

    #[error("Agent error: {0}")]
    Agent(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, YipsError>;
