//! Turn engine implementing the ReAct (Reason + Act) loop.
//!
//! The turn engine takes a user message, sends it to the LLM, processes any
//! tool calls, feeds results back to the LLM, and repeats until the LLM
//! produces a final response or the round limit is reached.

use crate::envelope::parse_envelope;
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use async_trait::async_trait;
use yips_core::message::{ChatMessage, ToolCall};
use yips_core::tool::{ToolDefinition, ToolOutput};

/// Configuration for a turn engine execution.
#[derive(Debug, Clone)]
pub struct TurnConfig {
    /// Maximum number of ReAct rounds.
    pub max_rounds: u32,
    /// Number of consecutive failures before pivoting strategy.
    pub failure_pivot_threshold: u32,
}

impl Default for TurnConfig {
    fn default() -> Self {
        Self {
            max_rounds: 6,
            failure_pivot_threshold: 2,
        }
    }
}

impl TurnConfig {
    pub fn from_agent_config(config: &yips_core::config::AgentConfig) -> Self {
        Self {
            max_rounds: config.max_rounds,
            failure_pivot_threshold: config.failure_pivot_threshold,
        }
    }
}

/// Result of a completed turn.
#[derive(Debug, Clone)]
pub struct TurnResult {
    /// Number of rounds used.
    pub rounds_used: u32,
    /// The final assistant response (if any).
    pub final_response: Option<String>,
    /// The complete conversation history for this turn.
    pub messages: Vec<ChatMessage>,
}

/// Abstraction over LLM requests and tool execution, enabling testing
/// and supporting different frontends.
#[async_trait]
pub trait AgentDependencies: Send + Sync {
    /// Send a chat completion request to the LLM.
    async fn chat_completion(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse>;

    /// Execute a tool call and return the result.
    async fn execute_tool(&self, name: &str, arguments: &str) -> Result<ToolOutput>;

    /// Get the list of available tool definitions.
    fn available_tools(&self) -> Vec<ToolDefinition>;

    /// Emit an event to the frontend (streaming token, tool status, etc.).
    async fn emit_event(&self, event: AgentEvent);
}

/// Response from an LLM chat completion.
#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,
}

/// The ReAct turn engine. Drives the conversation loop between the LLM and tools.
pub struct TurnEngine<D: AgentDependencies> {
    config: TurnConfig,
    deps: D,
}

impl<D: AgentDependencies> TurnEngine<D> {
    pub fn new(config: TurnConfig, deps: D) -> Self {
        Self { config, deps }
    }

    /// Run a complete turn starting from the given conversation history.
    ///
    /// The turn engine will:
    /// 1. Send messages to the LLM
    /// 2. If the LLM returns tool calls, execute them and append results
    /// 3. Repeat until the LLM produces a final response or max rounds is hit
    pub async fn run(&self, mut messages: Vec<ChatMessage>) -> Result<TurnResult> {
        let tools = self.deps.available_tools();
        let mut rounds_used = 0;
        let mut consecutive_failures = 0;

        loop {
            rounds_used += 1;
            if rounds_used > self.config.max_rounds {
                self.deps
                    .emit_event(AgentEvent::Error(format!(
                        "Max rounds ({}) exceeded",
                        self.config.max_rounds
                    )))
                    .await;
                return Err(AgentError::MaxRoundsExceeded(self.config.max_rounds));
            }

            self.deps
                .emit_event(AgentEvent::RoundStart {
                    round: rounds_used,
                    max_rounds: self.config.max_rounds,
                })
                .await;

            // Call the LLM
            let response = self.deps.chat_completion(&messages, &tools).await?;
            let envelope = parse_envelope(&response.content, response.tool_calls);

            // If no tool calls, this is the final response
            if envelope.is_final() {
                if !envelope.text.is_empty() {
                    self.deps
                        .emit_event(AgentEvent::AssistantMessage(envelope.text.clone()))
                        .await;
                }

                messages.push(ChatMessage::assistant(envelope.text.clone()));

                self.deps
                    .emit_event(AgentEvent::TurnComplete {
                        rounds_used,
                        final_response: Some(envelope.text.clone()),
                    })
                    .await;

                return Ok(TurnResult {
                    rounds_used,
                    final_response: Some(envelope.text),
                    messages,
                });
            }

            // Assistant message with tool calls
            if !envelope.text.is_empty() {
                self.deps
                    .emit_event(AgentEvent::AssistantMessage(envelope.text.clone()))
                    .await;
            }

            self.deps
                .emit_event(AgentEvent::ToolCallsRequested(envelope.tool_calls.clone()))
                .await;

            messages.push(ChatMessage::assistant_with_tool_calls(
                envelope.text.clone(),
                envelope.tool_calls.clone(),
            ));

            // Execute each tool call
            let mut any_failure = false;
            for tool_call in &envelope.tool_calls {
                self.deps
                    .emit_event(AgentEvent::ToolStart {
                        tool_call_id: tool_call.id.clone(),
                        tool_name: tool_call.name.clone(),
                    })
                    .await;

                let result = self
                    .deps
                    .execute_tool(&tool_call.name, &tool_call.arguments)
                    .await;

                let (output, success) = match result {
                    Ok(output) => (output.content.clone(), output.success),
                    Err(e) => (format!("Error: {}", e), false),
                };

                if !success {
                    any_failure = true;
                }

                self.deps
                    .emit_event(AgentEvent::ToolComplete {
                        tool_call_id: tool_call.id.clone(),
                        tool_name: tool_call.name.clone(),
                        success,
                        output: output.clone(),
                    })
                    .await;

                messages.push(ChatMessage::tool_result(
                    tool_call.id.clone(),
                    output,
                    success,
                ));
            }

            // Track consecutive failures for pivot logic
            if any_failure {
                consecutive_failures += 1;
                if consecutive_failures >= self.config.failure_pivot_threshold {
                    // Inject a hint to pivot strategy
                    messages.push(ChatMessage::system(
                        "Multiple consecutive tool failures detected. Consider a different approach."
                            .to_string(),
                    ));
                    consecutive_failures = 0;
                }
            } else {
                consecutive_failures = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct MockDeps {
        responses: Mutex<Vec<LlmResponse>>,
        events: Arc<Mutex<Vec<AgentEvent>>>,
        tools: Vec<ToolDefinition>,
    }

    #[async_trait::async_trait]
    impl AgentDependencies for MockDeps {
        async fn chat_completion(
            &self,
            _messages: &[ChatMessage],
            _tools: &[ToolDefinition],
        ) -> Result<LlmResponse> {
            let mut responses = self.responses.lock().unwrap();
            if responses.is_empty() {
                Err(AgentError::LlmError("No more responses".to_string()))
            } else {
                Ok(responses.remove(0))
            }
        }

        async fn execute_tool(&self, name: &str, _arguments: &str) -> Result<ToolOutput> {
            Ok(ToolOutput::ok(format!("Result from {}", name)))
        }

        fn available_tools(&self) -> Vec<ToolDefinition> {
            self.tools.clone()
        }

        async fn emit_event(&self, event: AgentEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    #[tokio::test]
    async fn simple_response_no_tools() {
        let deps = MockDeps {
            responses: Mutex::new(vec![LlmResponse {
                content: "Hello!".to_string(),
                tool_calls: None,
            }]),
            events: Arc::new(Mutex::new(Vec::new())),
            tools: Vec::new(),
        };

        let engine = TurnEngine::new(TurnConfig::default(), deps);
        let messages = vec![ChatMessage::user("Hi")];
        let result = engine.run(messages).await.unwrap();

        assert_eq!(result.rounds_used, 1);
        assert_eq!(result.final_response.as_deref(), Some("Hello!"));
    }

    #[tokio::test]
    async fn tool_call_then_response() {
        let deps = MockDeps {
            responses: Mutex::new(vec![
                LlmResponse {
                    content: "Let me read that.".to_string(),
                    tool_calls: Some(vec![ToolCall {
                        id: "call_1".to_string(),
                        name: "read_file".to_string(),
                        arguments: r#"{"path": "test.txt"}"#.to_string(),
                    }]),
                },
                LlmResponse {
                    content: "The file contains: Result from read_file".to_string(),
                    tool_calls: None,
                },
            ]),
            events: Arc::new(Mutex::new(Vec::new())),
            tools: Vec::new(),
        };

        let engine = TurnEngine::new(TurnConfig::default(), deps);
        let messages = vec![ChatMessage::user("Read test.txt")];
        let result = engine.run(messages).await.unwrap();

        assert_eq!(result.rounds_used, 2);
        assert!(result.final_response.is_some());
    }

    #[tokio::test]
    async fn max_rounds_exceeded() {
        let deps = MockDeps {
            responses: Mutex::new(
                (0..10)
                    .map(|i| LlmResponse {
                        content: format!("Round {}", i),
                        tool_calls: Some(vec![ToolCall {
                            id: format!("call_{}", i),
                            name: "read_file".to_string(),
                            arguments: "{}".to_string(),
                        }]),
                    })
                    .collect(),
            ),
            events: Arc::new(Mutex::new(Vec::new())),
            tools: Vec::new(),
        };

        let config = TurnConfig {
            max_rounds: 3,
            failure_pivot_threshold: 2,
        };
        let engine = TurnEngine::new(config, deps);
        let messages = vec![ChatMessage::user("Loop")];
        let result = engine.run(messages).await;

        assert!(matches!(result, Err(AgentError::MaxRoundsExceeded(3))));
    }
}
