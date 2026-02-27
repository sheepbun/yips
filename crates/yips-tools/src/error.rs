//! Tool-specific error types.

use thiserror::Error;

/// Errors that can occur during tool execution.
#[derive(Debug, Error)]
pub enum ToolError {
    #[error("Unknown tool: {0}")]
    UnknownTool(String),

    #[error("Invalid arguments: {0}")]
    InvalidArgs(String),

    #[error("Missing required argument: {0}")]
    MissingArg(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),

    #[error("Command timed out after {0} seconds")]
    Timeout(u64),

    #[error("Edit failed: {0}")]
    EditFailed(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ToolError>;
