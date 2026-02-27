//! The main `LlamaClient` for communicating with a llama.cpp HTTP server.

use crate::error::{LlmError, Result};
use crate::stream::{ChatCompletionStream, SseStream};
use crate::types::{ApiMessage, ApiTool, ChatCompletion, ChatCompletionRequest, ToolChoice};
use yips_core::config::LlmConfig;
use yips_core::message::ChatMessage;
use yips_core::tool::ToolDefinition;

/// Client for the llama.cpp OpenAI-compatible HTTP API.
#[derive(Debug, Clone)]
pub struct LlamaClient {
    /// The base URL of the llama.cpp server (e.g. `http://127.0.0.1:8080`).
    base_url: String,
    /// Model identifier to include in requests.
    model: String,
    /// Default sampling temperature.
    temperature: f32,
    /// Default max tokens.
    max_tokens: u32,
    /// Underlying HTTP client.
    http: reqwest::Client,
}

impl LlamaClient {
    /// Create a new client pointing at `base_url`.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            model: "default".to_string(),
            temperature: 0.7,
            max_tokens: 4096,
            http: reqwest::Client::new(),
        }
    }

    /// Create a client from a [`LlmConfig`].
    pub fn from_config(config: &LlmConfig) -> Self {
        Self {
            base_url: config.base_url.trim_end_matches('/').to_string(),
            model: config.model.clone(),
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            http: reqwest::Client::new(),
        }
    }

    /// Override the model identifier.
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Override the default temperature.
    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = temperature;
        self
    }

    /// Override the default max tokens.
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// Return the completions endpoint URL.
    fn completions_url(&self) -> String {
        format!("{}/v1/chat/completions", self.base_url)
    }

    /// Best-effort liveness check for the backend.
    ///
    /// Tries `GET /health` first and falls back to `GET /v1/models`.
    pub async fn health_check(&self) -> Result<()> {
        let health_url = format!("{}/health", self.base_url);
        let health_response = self.http.get(&health_url).send().await;
        if let Ok(response) = health_response {
            if response.status().is_success() {
                return Ok(());
            }
        }

        let models_url = format!("{}/v1/models", self.base_url);
        let models_response = self.http.get(&models_url).send().await?;
        if models_response.status().is_success() {
            Ok(())
        } else {
            Err(LlmError::Api {
                status: models_response.status().as_u16(),
                message: "Backend health check failed".to_string(),
            })
        }
    }

    /// Build a [`ChatCompletionRequest`] from the provided parameters, using
    /// instance defaults for any omitted values.
    fn build_request(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        tool_choice: Option<ToolChoice>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
        stream: bool,
    ) -> ChatCompletionRequest {
        let api_messages: Vec<ApiMessage> = messages.iter().map(ApiMessage::from).collect();

        let api_tools: Option<Vec<ApiTool>> =
            tools.map(|ts| ts.iter().map(ApiTool::from).collect());

        ChatCompletionRequest {
            model: self.model.clone(),
            messages: api_messages,
            temperature: Some(temperature.unwrap_or(self.temperature)),
            max_tokens: Some(max_tokens.unwrap_or(self.max_tokens)),
            tools: api_tools,
            tool_choice,
            stream: if stream { Some(true) } else { None },
        }
    }

    // -----------------------------------------------------------------------
    // Non-streaming
    // -----------------------------------------------------------------------

    /// Send a chat completion request and wait for the full response.
    pub async fn chat(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatCompletion> {
        self.chat_with_options(messages, tools, None, None, None)
            .await
    }

    /// Like [`chat`](Self::chat) but with explicit temperature, max_tokens,
    /// and tool_choice overrides.
    pub async fn chat_with_options(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        tool_choice: Option<ToolChoice>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<ChatCompletion> {
        let request =
            self.build_request(messages, tools, tool_choice, temperature, max_tokens, false);

        tracing::debug!(url = %self.completions_url(), "Sending chat completion request");

        let response = self
            .http
            .post(&self.completions_url())
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::error!(status = %status, body = %body, "API error");
            return Err(LlmError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let completion: ChatCompletion = response.json().await?;
        tracing::debug!(
            id = %completion.id,
            choices = completion.choices.len(),
            "Received chat completion"
        );

        Ok(completion)
    }

    // -----------------------------------------------------------------------
    // Streaming
    // -----------------------------------------------------------------------

    /// Send a streaming chat completion request and return a stream of chunks.
    pub async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatCompletionStream> {
        self.chat_stream_with_options(messages, tools, None, None, None)
            .await
    }

    /// Like [`chat_stream`](Self::chat_stream) but with explicit overrides.
    pub async fn chat_stream_with_options(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolDefinition]>,
        tool_choice: Option<ToolChoice>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    ) -> Result<ChatCompletionStream> {
        let request =
            self.build_request(messages, tools, tool_choice, temperature, max_tokens, true);

        tracing::debug!(url = %self.completions_url(), "Sending streaming chat completion request");

        let response = self
            .http
            .post(&self.completions_url())
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::error!(status = %status, body = %body, "API error");
            return Err(LlmError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let byte_stream = response.bytes_stream();
        let sse_stream = SseStream::new(byte_stream);

        Ok(Box::pin(sse_stream))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_from_default_config() {
        let config = LlmConfig::default();
        let client = LlamaClient::from_config(&config);
        assert_eq!(client.base_url, "http://127.0.0.1:8080");
        assert_eq!(client.model, "default");
    }

    #[test]
    fn builder_methods() {
        let client = LlamaClient::new("http://localhost:9090")
            .with_model("llama-3")
            .with_temperature(0.5)
            .with_max_tokens(2048);
        assert_eq!(client.model, "llama-3");
        assert_eq!(client.temperature, 0.5);
        assert_eq!(client.max_tokens, 2048);
    }

    #[test]
    fn completions_url_strips_trailing_slash() {
        let client = LlamaClient::new("http://localhost:8080/");
        assert_eq!(
            client.completions_url(),
            "http://localhost:8080/v1/chat/completions"
        );
    }
}
