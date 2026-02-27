//! Execute shell commands tool.

use async_trait::async_trait;
use serde_json::json;
use tokio::process::Command;
use yips_core::tool::ToolOutput;

use crate::error::{Result, ToolError};
use crate::tools::Tool;

/// Executes a shell command via `sh -c` and captures output.
pub struct RunCommandTool;

#[async_trait]
impl Tool for RunCommandTool {
    fn name(&self) -> &str {
        "run_command"
    }

    fn description(&self) -> &str {
        "Execute a shell command and return its stdout and stderr."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute"
                },
                "timeout_secs": {
                    "type": "integer",
                    "description": "Timeout in seconds. Defaults to 30."
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolOutput> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("command".into()))?;

        let timeout_secs = args
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(30);

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            Command::new("sh").arg("-c").arg(command).output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                let mut content = String::new();
                if !stdout.is_empty() {
                    content.push_str(&stdout);
                }
                if !stderr.is_empty() {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str("[stderr]\n");
                    content.push_str(&stderr);
                }

                let exit_code = output.status.code().unwrap_or(-1);
                if content.is_empty() {
                    content = format!("(no output, exit code {})", exit_code);
                } else {
                    content.push_str(&format!("\n[exit code: {}]", exit_code));
                }

                if output.status.success() {
                    Ok(ToolOutput::ok(content))
                } else {
                    Ok(ToolOutput::err(content))
                }
            }
            Ok(Err(e)) => Err(ToolError::Io(e)),
            Err(_) => Err(ToolError::Timeout(timeout_secs)),
        }
    }
}
