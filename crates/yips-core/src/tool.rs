//! Tool definition types shared between yips-tools and yips-llm.

use serde::{Deserialize, Serialize};

/// Definition of a tool that can be provided to the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Unique name for the tool.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// JSON Schema for the tool's parameters.
    pub parameters: serde_json::Value,
}

/// The result of executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    /// Whether the tool executed successfully.
    pub success: bool,
    /// The output content.
    pub content: String,
}

impl ToolOutput {
    pub fn ok(content: impl Into<String>) -> Self {
        Self {
            success: true,
            content: content.into(),
        }
    }

    pub fn err(content: impl Into<String>) -> Self {
        Self {
            success: false,
            content: content.into(),
        }
    }
}
