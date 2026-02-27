//! Conductor: composes system prompts, manages tool/skill registration,
//! and orchestrates agent turns.

use crate::engine::{AgentDependencies, LlmResponse, TurnConfig, TurnEngine, TurnResult};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use async_trait::async_trait;
use yips_core::message::ChatMessage;
use yips_core::tool::{ToolDefinition, ToolOutput};
use yips_llm::client::LlamaClient;
use yips_tools::registry::ToolRegistry;

/// The conductor wires together the LLM client, tool registry, and event
/// callbacks to create a fully functional agent.
pub struct Conductor {
    llm_client: LlamaClient,
    tool_registry: ToolRegistry,
    config: TurnConfig,
    system_prompt: String,
    event_sender: Option<tokio::sync::mpsc::UnboundedSender<AgentEvent>>,
}

impl Conductor {
    pub fn new(llm_client: LlamaClient, tool_registry: ToolRegistry, config: TurnConfig) -> Self {
        Self {
            llm_client,
            tool_registry,
            config,
            system_prompt: Self::default_system_prompt(),
            event_sender: None,
        }
    }

    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.system_prompt = prompt;
        self
    }

    pub fn with_event_sender(
        mut self,
        sender: tokio::sync::mpsc::UnboundedSender<AgentEvent>,
    ) -> Self {
        self.event_sender = Some(sender);
        self
    }

    /// Run a user message through the agent, returning the final result.
    pub async fn run_turn(&self, user_message: &str) -> Result<TurnResult> {
        self.run_turn_with_history(vec![
            ChatMessage::system(self.system_prompt.clone()),
            ChatMessage::user(user_message.to_string()),
        ])
        .await
    }

    /// Run a turn with an existing conversation history.
    pub async fn run_turn_with_history(&self, messages: Vec<ChatMessage>) -> Result<TurnResult> {
        let deps = ConductorDeps {
            llm_client: &self.llm_client,
            tool_registry: &self.tool_registry,
            event_sender: self.event_sender.clone(),
        };
        let engine = TurnEngine::new(self.config.clone(), deps);
        engine.run(messages).await
    }

    fn default_system_prompt() -> String {
        "You are Yips, a helpful AI coding assistant. You have access to tools \
         for reading files, writing files, editing files, searching with grep, \
         running commands, and listing directories. Use these tools to help \
         the user with their tasks. Be direct and helpful."
            .to_string()
    }
}

/// Internal implementation of AgentDependencies that wires together the
/// real LLM client and tool registry.
struct ConductorDeps<'a> {
    llm_client: &'a LlamaClient,
    tool_registry: &'a ToolRegistry,
    event_sender: Option<tokio::sync::mpsc::UnboundedSender<AgentEvent>>,
}

#[async_trait]
impl AgentDependencies for ConductorDeps<'_> {
    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse> {
        let response = self
            .llm_client
            .chat(messages, Some(tools))
            .await
            .map_err(|e| AgentError::LlmError(e.to_string()))?;

        let choice = response
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| AgentError::LlmError("No choices in response".to_string()))?;

        let msg = choice.message.into_chat_message();

        Ok(LlmResponse {
            content: msg.content,
            tool_calls: msg.tool_calls,
        })
    }

    async fn execute_tool(&self, name: &str, arguments: &str) -> Result<ToolOutput> {
        let args: serde_json::Value = serde_json::from_str(arguments)
            .map_err(|e| AgentError::ToolError(format!("Invalid JSON: {}", e)))?;

        self.tool_registry
            .execute(name, args)
            .await
            .map_err(|e| AgentError::ToolError(e.to_string()))
    }

    fn available_tools(&self) -> Vec<ToolDefinition> {
        self.tool_registry.definitions()
    }

    async fn emit_event(&self, event: AgentEvent) {
        if let Some(ref sender) = self.event_sender {
            let _ = sender.send(event);
        }
    }
}
