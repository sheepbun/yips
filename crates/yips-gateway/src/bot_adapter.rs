//! Adapter interfaces for external chat providers.

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Adapter-agnostic inbound user message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundMessage {
    pub adapter: String,
    pub user_id: String,
    pub channel_id: Option<String>,
    pub text: String,
}

/// Adapter-agnostic outbound message payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundMessage {
    pub target_user_id: String,
    pub target_channel_id: Option<String>,
    pub text: String,
}

/// Callback used by adapters to forward inbound user events into gateway runtime.
#[async_trait]
pub trait GatewayHandler: Send + Sync {
    async fn on_message(&self, msg: InboundMessage);
}

/// Bot adapter contract for external transports.
#[async_trait]
pub trait BotAdapter: Send + Sync {
    /// Stable adapter name (for example: `discord`).
    fn adapter_name(&self) -> &'static str;

    /// Start adapter event loop.
    async fn run(&self, handler: Arc<dyn GatewayHandler>) -> Result<()>;

    /// Send a message via the adapter.
    async fn send(&self, msg: OutboundMessage) -> Result<()>;
}
