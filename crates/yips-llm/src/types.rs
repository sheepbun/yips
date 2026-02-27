//! Request and response types for the llama.cpp `/v1/chat/completions` API.
//!
//! These follow the OpenAI chat completion format that llama.cpp serves.

use serde::{Deserialize, Serialize};
use yips_core::message::{ChatMessage, Role};
use yips_core::tool::ToolDefinition;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/// A chat completion request sent to `/v1/chat/completions`.
#[derive(Debug, Clone, Serialize)]
pub struct ChatCompletionRequest {
    /// Model identifier.
    pub model: String,

    /// The conversation messages.
    pub messages: Vec<ApiMessage>,

    /// Sampling temperature (0.0 - 2.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,

    /// Maximum number of tokens to generate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,

    /// Tool definitions the model may call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ApiTool>>,

    /// Controls which (if any) tool the model should use.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,

    /// Whether to stream the response via SSE.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

/// A message in the OpenAI API wire format.
///
/// This differs slightly from `yips_core::message::ChatMessage` because the
/// API expects tool calls nested under a `function` key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiMessage {
    pub role: Role,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ApiToolCall>>,

    /// Present when `role` is `tool` -- the id of the tool call this answers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// A tool call in the API wire format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ApiFunction,
}

/// The function payload inside an API tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiFunction {
    pub name: String,
    pub arguments: String,
}

/// A tool definition in the API wire format.
#[derive(Debug, Clone, Serialize)]
pub struct ApiTool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ApiFunctionDef,
}

/// Function metadata inside an API tool definition.
#[derive(Debug, Clone, Serialize)]
pub struct ApiFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Controls which tool the model should call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolChoice {
    /// `"none"`, `"auto"`, or `"required"`.
    Mode(String),
    /// Force a specific function.
    Function {
        #[serde(rename = "type")]
        choice_type: String,
        function: ToolChoiceFunction,
    },
}

/// Used inside [`ToolChoice::Function`] to name the specific function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolChoiceFunction {
    pub name: String,
}

// ---------------------------------------------------------------------------
// Response types (non-streaming)
// ---------------------------------------------------------------------------

/// A full (non-streaming) chat completion response.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletion {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<Choice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

/// A single choice in a chat completion response.
#[derive(Debug, Clone, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: ResponseMessage,
    pub finish_reason: Option<String>,
}

/// The message content inside a response choice.
#[derive(Debug, Clone, Deserialize)]
pub struct ResponseMessage {
    pub role: Role,
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ApiToolCall>>,
}

/// Token usage statistics.
#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

// ---------------------------------------------------------------------------
// Streaming (SSE) response types
// ---------------------------------------------------------------------------

/// A single SSE chunk from a streaming chat completion.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChunkChoice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

/// A single choice inside a streaming chunk.
#[derive(Debug, Clone, Deserialize)]
pub struct ChunkChoice {
    pub index: u32,
    pub delta: Delta,
    pub finish_reason: Option<String>,
}

/// Incremental content delivered in a streaming chunk.
#[derive(Debug, Clone, Deserialize)]
pub struct Delta {
    #[serde(default)]
    pub role: Option<Role>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<DeltaToolCall>>,
}

/// An incremental tool call in a streaming delta.
#[derive(Debug, Clone, Deserialize)]
pub struct DeltaToolCall {
    pub index: u32,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default, rename = "type")]
    pub call_type: Option<String>,
    #[serde(default)]
    pub function: Option<DeltaFunction>,
}

/// Incremental function data inside a delta tool call.
#[derive(Debug, Clone, Deserialize)]
pub struct DeltaFunction {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arguments: Option<String>,
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

impl From<&ChatMessage> for ApiMessage {
    fn from(msg: &ChatMessage) -> Self {
        let tool_calls = msg.tool_calls.as_ref().map(|tcs| {
            tcs.iter()
                .map(|tc| ApiToolCall {
                    id: tc.id.clone(),
                    call_type: "function".to_string(),
                    function: ApiFunction {
                        name: tc.name.clone(),
                        arguments: tc.arguments.clone(),
                    },
                })
                .collect()
        });

        // For tool-role messages the content may be empty string; the API
        // still expects the field present, so we always include it unless it
        // is truly empty AND there are tool_calls.
        let content = if msg.content.is_empty() && tool_calls.is_some() {
            None
        } else {
            Some(msg.content.clone())
        };

        Self {
            role: msg.role.clone(),
            content,
            tool_calls,
            tool_call_id: msg.tool_call_id.clone(),
        }
    }
}

impl From<&ToolDefinition> for ApiTool {
    fn from(td: &ToolDefinition) -> Self {
        Self {
            tool_type: "function".to_string(),
            function: ApiFunctionDef {
                name: td.name.clone(),
                description: td.description.clone(),
                parameters: td.parameters.clone(),
            },
        }
    }
}

impl ResponseMessage {
    /// Convert the API response message back into a `ChatMessage`.
    pub fn into_chat_message(self) -> ChatMessage {
        let tool_calls = self.tool_calls.map(|tcs| {
            tcs.into_iter()
                .map(|tc| yips_core::message::ToolCall {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                })
                .collect()
        });

        ChatMessage {
            role: self.role,
            content: self.content.unwrap_or_default(),
            tool_calls,
            tool_call_id: None,
        }
    }
}
