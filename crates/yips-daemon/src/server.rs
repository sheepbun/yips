use anyhow::{Context, Result};
use async_trait::async_trait;
use futures::StreamExt;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use yips_agent::engine::{AgentDependencies, LlmResponse, TurnConfig, TurnEngine};
use yips_agent::event::AgentEvent;
use yips_core::config::YipsConfig;
use yips_core::ipc::{read_message, write_message, ClientMessage, DaemonMessage};
use yips_core::message::{ChatMessage, ToolCall};
use yips_core::tool::{ToolDefinition, ToolOutput};
use yips_llm::client::LlamaClient;
use yips_llm::types::DeltaToolCall;
use yips_tools::registry::ToolRegistry;

use crate::session::SessionManager;

#[derive(Clone)]
pub struct DaemonServer {
    config: YipsConfig,
    socket_path: PathBuf,
    session_manager: SessionManager,
    tool_registry: Arc<ToolRegistry>,
    llama_client: Arc<LlamaClient>,
    active_turns: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    shutdown_tx: broadcast::Sender<()>,
}

impl DaemonServer {
    pub fn new(config: YipsConfig, socket_path: PathBuf) -> Self {
        let llama_client = Arc::new(LlamaClient::from_config(&config.llm));
        let tool_registry = Arc::new(ToolRegistry::new());
        let (shutdown_tx, _) = broadcast::channel(8);

        Self {
            config,
            socket_path,
            session_manager: SessionManager::new(),
            tool_registry,
            llama_client,
            active_turns: Arc::new(Mutex::new(HashMap::new())),
            shutdown_tx,
        }
    }

    pub async fn run(&self) -> Result<()> {
        if self.socket_path.exists() {
            std::fs::remove_file(&self.socket_path)
                .context("Failed to remove existing socket file")?;
        }

        let listener =
            UnixListener::bind(&self.socket_path).context("Failed to bind Unix socket")?;
        info!(socket = %self.socket_path.display(), "Listening for IPC connections");

        let mut shutdown_rx = self.shutdown_tx.subscribe();

        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((stream, _)) => {
                            let server = Arc::new(DaemonServerContext {
                                config: self.config.clone(),
                                session_manager: self.session_manager.clone(),
                                tool_registry: self.tool_registry.clone(),
                                llama_client: self.llama_client.clone(),
                                active_turns: self.active_turns.clone(),
                                shutdown_tx: self.shutdown_tx.clone(),
                            });

                            tokio::spawn(async move {
                                if let Err(e) = server.handle_connection(stream).await {
                                    error!(error = %e, "Connection handler failed");
                                }
                            });
                        }
                        Err(e) => {
                            error!(error = %e, "Accept error");
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    info!("Shutdown signal received");
                    break;
                }
            }
        }

        self.abort_active_turns().await;

        if self.socket_path.exists() {
            if let Err(e) = std::fs::remove_file(&self.socket_path) {
                warn!(error = %e, socket = %self.socket_path.display(), "Failed to remove socket during shutdown");
            }
        }

        Ok(())
    }

    async fn abort_active_turns(&self) {
        let mut active = self.active_turns.lock().await;
        for (_, handle) in active.drain() {
            handle.abort();
        }
    }
}

struct DaemonServerContext {
    config: YipsConfig,
    session_manager: SessionManager,
    tool_registry: Arc<ToolRegistry>,
    llama_client: Arc<LlamaClient>,
    active_turns: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    shutdown_tx: broadcast::Sender<()>,
}

impl DaemonServerContext {
    async fn handle_connection(&self, stream: UnixStream) -> Result<()> {
        let (tx, mut rx) = mpsc::channel::<DaemonMessage>(64);
        let (mut reader, writer) = stream.into_split();

        let writer_task = tokio::spawn(async move {
            let mut writer = writer;
            while let Some(msg) = rx.recv().await {
                if let Err(e) = write_message(&mut writer, &msg).await {
                    error!(error = %e, "Failed to write IPC message");
                    break;
                }
            }
        });

        loop {
            let msg: ClientMessage = match read_message(&mut reader).await {
                Ok(m) => m,
                Err(_) => break,
            };

            match msg {
                ClientMessage::Chat {
                    session_id,
                    message,
                    working_directory,
                } => {
                    let session_arc = self
                        .session_manager
                        .get_or_create(session_id, working_directory.clone());

                    let (resolved_session_id, messages) = {
                        let mut session = session_arc.write().unwrap();
                        if let Some(wd) = working_directory {
                            session.working_directory = Some(wd);
                        }
                        session.add_message(ChatMessage::user(message));
                        (session.id.clone(), session.messages.clone())
                    };

                    let deps = IpcAgentDependencies {
                        session_id: resolved_session_id.clone(),
                        tx: tx.clone(),
                        llama_client: self.llama_client.clone(),
                        tool_registry: self.tool_registry.clone(),
                    };

                    let turn_config = TurnConfig::from_agent_config(&self.config.agent);
                    let engine = TurnEngine::new(turn_config, deps);

                    self.cancel_existing_turn(&resolved_session_id, &tx).await;

                    let tx_clone = tx.clone();
                    let active_turns = self.active_turns.clone();
                    let session_id_for_task = resolved_session_id.clone();
                    let turn_handle = tokio::spawn(async move {
                        let run_result = engine.run(messages).await;

                        match run_result {
                            Ok(result) => {
                                {
                                    let mut session = session_arc.write().unwrap();
                                    session.messages = result.messages;
                                }
                                let _ = tx_clone
                                    .send(DaemonMessage::TurnComplete {
                                        session_id: session_id_for_task.clone(),
                                        round_count: result.rounds_used,
                                    })
                                    .await;
                            }
                            Err(e) => {
                                let _ = tx_clone
                                    .send(DaemonMessage::Error {
                                        session_id: Some(session_id_for_task.clone()),
                                        message: e.to_string(),
                                    })
                                    .await;
                            }
                        }

                        let mut turns = active_turns.lock().await;
                        turns.remove(&session_id_for_task);
                    });

                    let mut turns = self.active_turns.lock().await;
                    turns.insert(resolved_session_id, turn_handle);
                }
                ClientMessage::Status => {
                    let active_sessions = self.session_manager.list_ids();
                    let llm_connected = self.check_llm_connected().await;
                    tx.send(DaemonMessage::StatusResponse {
                        active_sessions,
                        llm_connected,
                    })
                    .await?;
                }
                ClientMessage::ListSessions => {
                    let sessions = self.session_manager.list_info();
                    tx.send(DaemonMessage::SessionList { sessions }).await?;
                }
                ClientMessage::Cancel { session_id } => {
                    let cancelled = self.cancel_turn(&session_id).await;
                    let message = if cancelled {
                        format!("Cancelled session turn: {}", session_id)
                    } else {
                        format!("No active turn for session: {}", session_id)
                    };
                    tx.send(DaemonMessage::Error {
                        session_id: Some(session_id),
                        message,
                    })
                    .await?;
                }
                ClientMessage::Shutdown => {
                    info!("Shutdown requested by client");
                    let _ = self.shutdown_tx.send(());
                    break;
                }
            }
        }

        drop(tx);
        let _ = writer_task.await;
        Ok(())
    }

    async fn check_llm_connected(&self) -> bool {
        tokio::time::timeout(
            Duration::from_millis(1500),
            self.llama_client.health_check(),
        )
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
    }

    async fn cancel_existing_turn(&self, session_id: &str, tx: &mpsc::Sender<DaemonMessage>) {
        if self.cancel_turn(session_id).await {
            let _ = tx
                .send(DaemonMessage::Error {
                    session_id: Some(session_id.to_string()),
                    message: "Previous turn cancelled by a new chat request".to_string(),
                })
                .await;
        }
    }

    async fn cancel_turn(&self, session_id: &str) -> bool {
        let mut turns = self.active_turns.lock().await;
        if let Some(handle) = turns.remove(session_id) {
            handle.abort();
            true
        } else {
            false
        }
    }
}

#[derive(Clone)]
struct IpcAgentDependencies {
    session_id: String,
    tx: mpsc::Sender<DaemonMessage>,
    llama_client: Arc<LlamaClient>,
    tool_registry: Arc<ToolRegistry>,
}

#[derive(Debug, Default, Clone)]
struct PendingToolCall {
    id: Option<String>,
    name: String,
    arguments: String,
}

#[async_trait]
impl AgentDependencies for IpcAgentDependencies {
    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
    ) -> yips_agent::error::Result<LlmResponse> {
        let mut stream = self
            .llama_client
            .chat_stream(messages, Some(tools))
            .await
            .map_err(|e| yips_agent::error::AgentError::LlmError(e.to_string()))?;

        let mut full_content = String::new();
        let mut partial_calls: BTreeMap<u32, PendingToolCall> = BTreeMap::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk =
                chunk_result.map_err(|e| yips_agent::error::AgentError::LlmError(e.to_string()))?;

            if let Some(choice) = chunk.choices.first() {
                if let Some(content) = &choice.delta.content {
                    full_content.push_str(content);
                    self.emit_event(AgentEvent::Token(content.to_string()))
                        .await;
                }

                if let Some(delta_calls) = &choice.delta.tool_calls {
                    for delta in delta_calls {
                        merge_tool_call_delta(&mut partial_calls, delta);
                    }
                }
            }
        }

        let tool_calls: Vec<ToolCall> = partial_calls
            .into_iter()
            .filter_map(|(index, call)| {
                if call.name.is_empty() {
                    return None;
                }

                let id = call.id.unwrap_or_else(|| format!("call_{}", index));
                let arguments = if call.arguments.trim().is_empty() {
                    "{}".to_string()
                } else {
                    call.arguments
                };

                Some(ToolCall {
                    id,
                    name: call.name,
                    arguments,
                })
            })
            .collect();

        Ok(LlmResponse {
            content: full_content,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
        })
    }

    async fn execute_tool(
        &self,
        name: &str,
        arguments: &str,
    ) -> yips_agent::error::Result<ToolOutput> {
        let args_json: serde_json::Value = serde_json::from_str(arguments).map_err(|e| {
            yips_agent::error::AgentError::ToolError(format!("Invalid JSON arguments: {}", e))
        })?;

        self.tool_registry
            .execute(name, args_json)
            .await
            .map_err(|e| yips_agent::error::AgentError::ToolError(e.to_string()))
    }

    fn available_tools(&self) -> Vec<ToolDefinition> {
        self.tool_registry.definitions()
    }

    async fn emit_event(&self, event: AgentEvent) {
        let msg = match event {
            AgentEvent::Token(token) => DaemonMessage::Token {
                session_id: self.session_id.clone(),
                token,
            },
            AgentEvent::AssistantMessage(content) => DaemonMessage::AssistantMessage {
                session_id: self.session_id.clone(),
                content,
                tool_calls: None,
            },
            AgentEvent::ToolStart {
                tool_call_id,
                tool_name,
            } => DaemonMessage::ToolStart {
                session_id: self.session_id.clone(),
                tool_call_id,
                tool_name,
            },
            AgentEvent::ToolComplete {
                tool_call_id,
                success,
                output,
                ..
            } => DaemonMessage::ToolResult {
                session_id: self.session_id.clone(),
                tool_call_id,
                success,
                output,
            },
            AgentEvent::Error(message) => DaemonMessage::Error {
                session_id: Some(self.session_id.clone()),
                message,
            },
            _ => return,
        };

        let _ = self.tx.send(msg).await;
    }
}

fn merge_tool_call_delta(calls: &mut BTreeMap<u32, PendingToolCall>, delta: &DeltaToolCall) {
    let entry = calls.entry(delta.index).or_default();

    if let Some(id) = &delta.id {
        if !id.is_empty() {
            entry.id = Some(id.clone());
        }
    }

    if let Some(function) = &delta.function {
        if let Some(name) = &function.name {
            entry.name.push_str(name);
        }
        if let Some(arguments) = &function.arguments {
            entry.arguments.push_str(arguments);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_tool_call_delta_reassembles_fragments() {
        let mut calls = BTreeMap::new();

        let delta_1 = DeltaToolCall {
            index: 0,
            id: Some("call_123".to_string()),
            call_type: Some("function".to_string()),
            function: Some(yips_llm::types::DeltaFunction {
                name: Some("read_".to_string()),
                arguments: Some("{\"path\":\"".to_string()),
            }),
        };

        let delta_2 = DeltaToolCall {
            index: 0,
            id: None,
            call_type: None,
            function: Some(yips_llm::types::DeltaFunction {
                name: Some("file".to_string()),
                arguments: Some("Cargo.toml\"}".to_string()),
            }),
        };

        merge_tool_call_delta(&mut calls, &delta_1);
        merge_tool_call_delta(&mut calls, &delta_2);

        let call = calls.get(&0).unwrap();
        assert_eq!(call.id.as_deref(), Some("call_123"));
        assert_eq!(call.name, "read_file");
        assert_eq!(call.arguments, "{\"path\":\"Cargo.toml\"}");
    }
}
