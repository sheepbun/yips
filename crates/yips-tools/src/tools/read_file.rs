//! Read file contents tool.

use async_trait::async_trait;
use serde_json::json;
use yips_core::tool::ToolOutput;

use crate::error::{Result, ToolError};
use crate::tools::Tool;

/// Reads the contents of a file, optionally with offset and line limit.
pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Read the contents of a file. Returns lines with line numbers."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the file to read"
                },
                "offset": {
                    "type": "integer",
                    "description": "Line number to start reading from (1-based). Defaults to 1."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of lines to read. Defaults to reading all lines."
                }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolOutput> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("path".into()))?;

        let offset = args
            .get("offset")
            .and_then(|v| v.as_u64())
            .map(|v| v.max(1) as usize)
            .unwrap_or(1);

        let limit = args
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);

        let content = tokio::fs::read_to_string(path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ToolError::FileNotFound(path.to_string())
            } else {
                ToolError::Io(e)
            }
        })?;

        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        // offset is 1-based
        let start = (offset - 1).min(total_lines);
        let end = match limit {
            Some(lim) => (start + lim).min(total_lines),
            None => total_lines,
        };

        let mut output = String::new();
        for (i, line) in lines[start..end].iter().enumerate() {
            let line_num = start + i + 1;
            output.push_str(&format!("{:>6}\t{}\n", line_num, line));
        }

        if output.is_empty() {
            output = "(empty file)\n".to_string();
        }

        Ok(ToolOutput::ok(output))
    }
}
