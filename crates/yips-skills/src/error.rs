//! Skill-specific error types.

use std::path::PathBuf;
use thiserror::Error;

/// Errors that can occur during skill discovery and execution.
#[derive(Debug, Error)]
pub enum SkillError {
    #[error("manifest not found in directory: {0}")]
    ManifestNotFound(PathBuf),

    #[error("failed to parse manifest at {path}: {source}")]
    ManifestParse {
        path: PathBuf,
        source: serde_json::Error,
    },

    #[error("no executable found in skill directory: {0}")]
    ExecutableNotFound(PathBuf),

    #[error("skill directory does not exist: {0}")]
    DirectoryNotFound(PathBuf),

    #[error("skill '{name}' timed out after {timeout_secs}s")]
    Timeout { name: String, timeout_secs: u64 },

    #[error("skill '{name}' exited with status {status}: {stderr}")]
    ExecutionFailed {
        name: String,
        status: i32,
        stderr: String,
    },

    #[error("skill '{name}' produced invalid output: {source}")]
    InvalidOutput {
        name: String,
        source: serde_json::Error,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, SkillError>;

impl From<SkillError> for yips_core::error::YipsError {
    fn from(err: SkillError) -> Self {
        yips_core::error::YipsError::Skill(err.to_string())
    }
}
