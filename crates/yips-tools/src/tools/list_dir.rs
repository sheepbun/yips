//! List directory contents tool.

use async_trait::async_trait;
use serde_json::json;
use yips_core::tool::ToolOutput;

use crate::error::{Result, ToolError};
use crate::tools::Tool;

/// Lists entries in a directory with type indicators.
pub struct ListDirTool;

#[async_trait]
impl Tool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn description(&self) -> &str {
        "List the contents of a directory. Directories are shown with a trailing /."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute path to the directory to list"
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

        let dir = std::path::Path::new(path);
        if !dir.exists() {
            return Err(ToolError::FileNotFound(path.to_string()));
        }
        if !dir.is_dir() {
            return Err(ToolError::InvalidArgs(format!(
                "{} is not a directory",
                path
            )));
        }

        let mut entries = tokio::fs::read_dir(path).await?;
        let mut names: Vec<String> = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            let name = entry.file_name().to_string_lossy().to_string();
            if file_type.is_dir() {
                names.push(format!("{}/", name));
            } else if file_type.is_symlink() {
                names.push(format!("{}@", name));
            } else {
                names.push(name);
            }
        }

        names.sort();

        if names.is_empty() {
            Ok(ToolOutput::ok("(empty directory)"))
        } else {
            Ok(ToolOutput::ok(names.join("\n")))
        }
    }
}
