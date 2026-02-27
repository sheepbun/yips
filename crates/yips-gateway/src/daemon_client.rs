//! IPC client wrapper used by gateway to talk to yips-daemon.

use std::path::Path;

use async_trait::async_trait;
use tokio::net::UnixStream;
use yips_core::ipc::{read_message, write_message, ClientMessage, DaemonMessage};

use crate::error::{GatewayError, Result};

/// Daemon RPC surface used by gateway runtime.
#[async_trait]
pub trait DaemonClientApi: Send {
    /// Send a chat message for an existing session and wait for final assistant response.
    async fn send_chat(&mut self, session_id: String, text: String) -> Result<String>;
}

/// IPC daemon client implementation over Unix sockets.
pub struct DaemonClient {
    stream: UnixStream,
}

impl DaemonClient {
    /// Connect to a daemon Unix socket.
    pub async fn connect(socket_path: &Path) -> Result<Self> {
        let stream = UnixStream::connect(socket_path).await?;
        Ok(Self { stream })
    }
}

#[async_trait]
impl DaemonClientApi for DaemonClient {
    async fn send_chat(&mut self, session_id: String, text: String) -> Result<String> {
        let request = ClientMessage::Chat {
            session_id: Some(session_id.clone()),
            message: text,
            working_directory: None,
        };

        write_message(&mut self.stream, &request).await?;

        let mut latest_assistant: Option<String> = None;

        loop {
            let message: DaemonMessage = read_message(&mut self.stream).await?;

            match message {
                DaemonMessage::AssistantMessage {
                    session_id: msg_session_id,
                    content,
                    ..
                } if msg_session_id == session_id => {
                    latest_assistant = Some(content);
                }
                DaemonMessage::TurnComplete {
                    session_id: msg_session_id,
                    ..
                } if msg_session_id == session_id => {
                    return Ok(latest_assistant.unwrap_or_default());
                }
                DaemonMessage::Error {
                    session_id: msg_session_id,
                    message,
                } => {
                    if msg_session_id.as_deref().is_none_or(|id| id == session_id) {
                        return Err(GatewayError::Daemon(message));
                    }
                }
                _ => {}
            }
        }
    }
}
