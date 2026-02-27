//! # yips-llm
//!
//! A llama.cpp HTTP client with SSE streaming and non-streaming support.
//! Targets the OpenAI-compatible `/v1/chat/completions` endpoint that
//! llama.cpp serves.

pub mod client;
pub mod error;
pub mod stream;
pub mod types;

pub use client::LlamaClient;
pub use error::{LlmError, Result};
pub use stream::ChatCompletionStream;
pub use types::{ChatCompletion, ChatCompletionChunk, ChatCompletionRequest, ToolChoice};
