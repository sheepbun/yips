//! IPC protocol types for communication between daemon and clients.
//!
//! Protocol: length-prefixed JSON over Unix domain sockets.
//! Format: `[4-byte u32 BE length][JSON payload]`

use crate::error::{Result, YipsError};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Messages sent from clients to the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    /// Send a user message to the agent.
    Chat {
        session_id: Option<String>,
        message: String,
        working_directory: Option<String>,
    },
    /// List active sessions.
    ListSessions,
    /// Cancel the current agent turn.
    Cancel { session_id: String },
    /// Request daemon status.
    Status,
    /// Gracefully shut down the daemon.
    Shutdown,
}

/// Messages sent from the daemon to clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum DaemonMessage {
    /// A streaming token from the assistant.
    Token { session_id: String, token: String },
    /// The assistant's complete response for a turn.
    AssistantMessage {
        session_id: String,
        content: String,
        tool_calls: Option<Vec<crate::message::ToolCall>>,
    },
    /// A tool is being executed.
    ToolStart {
        session_id: String,
        tool_call_id: String,
        tool_name: String,
    },
    /// A tool has finished executing.
    ToolResult {
        session_id: String,
        tool_call_id: String,
        success: bool,
        output: String,
    },
    /// The agent turn is complete.
    TurnComplete {
        session_id: String,
        round_count: u32,
    },
    /// Result of a cancel request or implicit cancellation.
    CancelResult {
        session_id: String,
        outcome: CancelOutcome,
        origin: CancelOrigin,
    },
    /// An error occurred.
    Error {
        session_id: Option<String>,
        message: String,
    },
    /// Response to a status request.
    StatusResponse {
        active_sessions: Vec<String>,
        llm_connected: bool,
    },
    /// Response to a list sessions request.
    SessionList { sessions: Vec<SessionInfo> },
}

/// Outcome of a cancel attempt for a session turn.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CancelOutcome {
    /// An active turn existed and was cancelled.
    CancelledActiveTurn,
    /// No active turn existed for the session.
    NoActiveTurn,
}

/// Source of a cancel operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CancelOrigin {
    /// Explicit client-initiated cancel request.
    UserRequest,
    /// Previous turn was cancelled because a new chat arrived for the same session.
    SupersededByNewChat,
}

/// Information about an active session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: String,
    pub message_count: usize,
}

/// Write a length-prefixed JSON message to an async writer.
pub async fn write_message<W, T>(writer: &mut W, msg: &T) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    let json = serde_json::to_vec(msg)?;
    let len = json.len() as u32;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&json).await?;
    writer.flush().await?;
    Ok(())
}

/// Read a length-prefixed JSON message from an async reader.
pub async fn read_message<R, T>(reader: &mut R) -> Result<T>
where
    R: AsyncReadExt + Unpin,
    T: for<'de> Deserialize<'de>,
{
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;

    if len > 10 * 1024 * 1024 {
        return Err(YipsError::Ipc(format!(
            "Message too large: {} bytes (max 10MB)",
            len
        )));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    serde_json::from_slice(&buf).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn roundtrip_message() {
        let msg = ClientMessage::Chat {
            session_id: None,
            message: "Hello".to_string(),
            working_directory: None,
        };

        let mut buf = Vec::new();
        write_message(&mut buf, &msg).await.unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let decoded: ClientMessage = read_message(&mut cursor).await.unwrap();

        match decoded {
            ClientMessage::Chat { message, .. } => assert_eq!(message, "Hello"),
            _ => panic!("Wrong variant"),
        }
    }
}
