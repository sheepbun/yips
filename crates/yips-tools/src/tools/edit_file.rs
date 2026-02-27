//! Edit file with find-and-replace tool.

use async_trait::async_trait;
use serde_json::json;
use yips_core::tool::ToolOutput;

use crate::error::{Result, ToolError};
use crate::tools::Tool;

/// Performs exact string replacement in an existing file.
/// Errors if the old_string is not found or matches more than once.
pub struct EditFileTool;

#[async_trait]
impl Tool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn description(&self) -> &str {
        "Edit a file by replacing an exact string with a new string. \
         The old_string must appear exactly once in the file."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the file to edit"
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact string to find in the file"
                },
                "new_string": {
                    "type": "string",
                    "description": "The string to replace old_string with"
                }
            },
            "required": ["path", "old_string", "new_string"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolOutput> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("path".into()))?;

        let old_string = args
            .get("old_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("old_string".into()))?;

        let new_string = args
            .get("new_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("new_string".into()))?;

        let content = tokio::fs::read_to_string(path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ToolError::FileNotFound(path.to_string())
            } else {
                ToolError::Io(e)
            }
        })?;

        // Count occurrences.
        let match_count = content.matches(old_string).count();
        if match_count == 0 {
            return Err(ToolError::EditFailed(format!(
                "old_string not found in {}",
                path
            )));
        }
        if match_count > 1 {
            return Err(ToolError::EditFailed(format!(
                "old_string found {} times in {} (must be unique)",
                match_count, path
            )));
        }

        let new_content = content.replacen(old_string, new_string, 1);
        tokio::fs::write(path, &new_content).await?;

        // Build a brief snippet around the edit for confirmation.
        let snippet = build_snippet(&new_content, new_string);
        Ok(ToolOutput::ok(format!(
            "Applied edit to {}\n{}",
            path, snippet
        )))
    }
}

/// Build a short snippet showing a few lines of context around the replacement.
fn build_snippet(content: &str, new_string: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    // Find the first line that contains the start of new_string.
    let needle = new_string.lines().next().unwrap_or(new_string);
    if needle.is_empty() {
        return String::new();
    }
    if let Some(pos) = lines.iter().position(|l| l.contains(needle)) {
        let start = pos.saturating_sub(2);
        let end = (pos + 3).min(lines.len());
        let mut snippet = String::new();
        for (i, line) in lines[start..end].iter().enumerate() {
            let line_num = start + i + 1;
            snippet.push_str(&format!("{:>6}\t{}\n", line_num, line));
        }
        snippet
    } else {
        String::new()
    }
}
