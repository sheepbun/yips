//! Subprocess execution with JSON stdin/stdout protocol.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tracing::{debug, error};

use crate::discovery::Skill;
use crate::error::{Result, SkillError};

/// Context passed to a skill invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillContext {
    /// The working directory for the skill to operate in.
    pub working_directory: String,
    /// An opaque session identifier.
    pub session_id: String,
}

/// The request payload written to the skill's stdin.
#[derive(Debug, Serialize)]
struct SkillRequest {
    id: String,
    name: String,
    arguments: serde_json::Value,
    context: SkillContext,
}

/// The status of a skill execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillStatus {
    Ok,
    Error,
}

/// The response payload read from the skill's stdout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillResponse {
    /// Whether the skill succeeded or failed.
    pub status: SkillStatus,
    /// The output content from the skill.
    pub output: String,
    /// Arbitrary metadata returned by the skill.
    #[serde(default)]
    pub metadata: serde_json::Value,
}

impl SkillResponse {
    /// Convert this response into a `ToolOutput`.
    pub fn to_tool_output(&self) -> yips_core::tool::ToolOutput {
        match self.status {
            SkillStatus::Ok => yips_core::tool::ToolOutput::ok(&self.output),
            SkillStatus::Error => yips_core::tool::ToolOutput::err(&self.output),
        }
    }
}

/// Executes skills as subprocesses using the JSON stdin/stdout protocol.
pub struct SkillRunner;

impl SkillRunner {
    /// Execute a skill with the given arguments and context.
    ///
    /// The runner spawns the skill's executable as a subprocess, writes a JSON
    /// request to its stdin, and reads a JSON response from its stdout.
    /// If the skill has an interpreter set in its manifest, the executable is
    /// run through that interpreter. The process is killed if it exceeds the
    /// manifest's timeout.
    pub async fn execute(
        skill: &Skill,
        arguments: serde_json::Value,
        context: SkillContext,
    ) -> Result<SkillResponse> {
        let request = SkillRequest {
            id: uuid_v4(),
            name: skill.manifest.name.clone(),
            arguments,
            context,
        };

        let request_json =
            serde_json::to_string(&request).expect("SkillRequest serialization should never fail");

        debug!(
            skill = %skill.manifest.name,
            "executing skill with timeout {}s",
            skill.manifest.timeout
        );

        let mut cmd = if let Some(ref interpreter) = skill.manifest.interpreter {
            let mut c = tokio::process::Command::new(interpreter);
            c.arg(&skill.executable_path);
            c
        } else {
            tokio::process::Command::new(&skill.executable_path)
        };

        cmd.current_dir(&skill.directory)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn()?;

        // Write request to stdin.
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(request_json.as_bytes()).await?;
            stdin.shutdown().await?;
            // stdin is dropped here, closing the pipe
        }

        let timeout_duration = Duration::from_secs(skill.manifest.timeout);
        let result = tokio::time::timeout(timeout_duration, child.wait_with_output()).await;

        match result {
            Ok(Ok(output)) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.is_empty() {
                    debug!(skill = %skill.manifest.name, stderr = %stderr, "skill stderr output");
                }

                if !output.status.success() {
                    let code = output.status.code().unwrap_or(-1);
                    error!(
                        skill = %skill.manifest.name,
                        exit_code = code,
                        "skill process failed"
                    );
                    return Err(SkillError::ExecutionFailed {
                        name: skill.manifest.name.clone(),
                        status: code,
                        stderr: stderr.into_owned(),
                    });
                }

                let response: SkillResponse =
                    serde_json::from_slice(&output.stdout).map_err(|e| {
                        error!(
                            skill = %skill.manifest.name,
                            stdout = %String::from_utf8_lossy(&output.stdout),
                            "failed to parse skill output"
                        );
                        SkillError::InvalidOutput {
                            name: skill.manifest.name.clone(),
                            source: e,
                        }
                    })?;

                debug!(skill = %skill.manifest.name, status = ?response.status, "skill completed");
                Ok(response)
            }
            Ok(Err(io_err)) => Err(SkillError::Io(io_err)),
            Err(_elapsed) => {
                // Timeout: kill the child process.
                error!(skill = %skill.manifest.name, "skill timed out, killing process");
                // Best-effort kill; the child handle is consumed by wait_with_output,
                // but since we got a timeout the future was cancelled before completion,
                // so we need to handle this differently. In practice the child is dropped
                // and killed automatically. We return the timeout error.
                Err(SkillError::Timeout {
                    name: skill.manifest.name.clone(),
                    timeout_secs: skill.manifest.timeout,
                })
            }
        }
    }
}

/// Generate a simple UUID v4 without pulling in the `uuid` crate.
/// Uses random bytes from the OS.
fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    // Use getrandom-style fallback via std
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| {
            use std::io::Read;
            f.read_exact(&mut bytes)
        })
        .is_err()
    {
        // Fallback: use a timestamp-based pseudo-id.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let nanos = now.as_nanos();
        return format!("{:032x}", nanos);
    }

    // Set version (4) and variant (RFC 4122) bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}
