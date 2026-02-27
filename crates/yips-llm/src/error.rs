//! LLM-specific error types.

use thiserror::Error;

/// Errors that can occur during LLM operations.
#[derive(Debug, Error)]
pub enum LlmError {
    /// HTTP request failed.
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// Failed to parse JSON response.
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    /// The LLM server returned a non-success status code.
    #[error("API error (status {status}): {message}")]
    Api { status: u16, message: String },

    /// Error while parsing SSE stream.
    #[error("Stream error: {0}")]
    Stream(String),

    /// The stream ended unexpectedly without a [DONE] marker.
    #[error("Stream ended unexpectedly")]
    StreamEnded,

    /// Invalid configuration.
    #[error("Configuration error: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, LlmError>;

impl From<LlmError> for yips_core::error::YipsError {
    fn from(err: LlmError) -> Self {
        yips_core::error::YipsError::Llm(err.to_string())
    }
}
