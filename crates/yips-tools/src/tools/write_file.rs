//! Write file contents tool.

use async_trait::async_trait;
use serde_json::json;
use yips_core::tool::ToolOutput;

use crate::error::{Result, ToolError};
use crate::tools::Tool;

/// Writes content to a file, creating parent directories as needed.
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "Write content to a file. Creates parent directories if they don't exist."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the file to write"
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file"
                }
            },
            "required": ["path", "content"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolOutput> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("path".into()))?;

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("content".into()))?;

        // Create parent directories if needed.
        if let Some(parent) = std::path::Path::new(path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        tokio::fs::write(path, content).await?;

        let line_count = content.lines().count();
        Ok(ToolOutput::ok(format!(
            "Wrote {} lines to {}",
            line_count, path
        )))
    }
}
