//! Agent-specific error types.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("LLM request failed: {0}")]
    LlmError(String),

    #[error("Tool execution failed: {0}")]
    ToolError(String),

    #[error("Skill execution failed: {0}")]
    SkillError(String),

    #[error("Max rounds exceeded ({0})")]
    MaxRoundsExceeded(u32),

    #[error("Cancelled by user")]
    Cancelled,

    #[error("Envelope parse error: {0}")]
    EnvelopeError(String),

    #[error("{0}")]
    Other(String),
}

impl From<yips_core::error::YipsError> for AgentError {
    fn from(e: yips_core::error::YipsError) -> Self {
        AgentError::Other(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AgentError>;
