//! Gateway runtime orchestration: policy checks, session routing, daemon forwarding.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tracing::error;

use crate::bot_adapter::{BotAdapter, GatewayHandler, InboundMessage, OutboundMessage};
use crate::daemon_client::DaemonClientApi;
use crate::error::{GatewayError, Result};
use crate::policy::{AuthPolicy, NowProvider, RateLimitDecision, RateLimiter, SystemNow};
use crate::session_router::SessionRouter;

const AUTH_DENIED_MESSAGE: &str = "You are not authorized to use this bot.";
const RATE_LIMIT_MESSAGE_PREFIX: &str = "Rate limit exceeded. Please retry in";
const INTERNAL_ERROR_MESSAGE: &str = "I hit an internal error; please retry.";

/// Core gateway runtime state and processing logic.
#[derive(Debug)]
pub struct GatewayRuntime<C: NowProvider = SystemNow> {
    session_router: SessionRouter,
    auth_policy: AuthPolicy,
    rate_limiter: Mutex<RateLimiter<C>>,
}

impl<C: NowProvider> GatewayRuntime<C> {
    /// Build runtime from routing, auth, and rate-limit settings.
    pub fn new(
        session_prefix: impl Into<String>,
        auth_policy: AuthPolicy,
        max_requests: u32,
        window: Duration,
        clock: C,
    ) -> Self {
        Self {
            session_router: SessionRouter::new(session_prefix),
            auth_policy,
            rate_limiter: Mutex::new(RateLimiter::new(max_requests, window, clock)),
        }
    }

    /// Process one inbound message through policy checks and daemon forwarding.
    pub async fn process_message(
        &self,
        daemon: &mut dyn DaemonClientApi,
        adapter: &dyn BotAdapter,
        msg: InboundMessage,
    ) -> Result<()> {
        if !self.auth_policy.is_allowed(&msg.user_id) {
            adapter
                .send(OutboundMessage {
                    target_user_id: msg.user_id,
                    target_channel_id: msg.channel_id,
                    text: AUTH_DENIED_MESSAGE.to_string(),
                })
                .await
                .map_err(|e| GatewayError::Adapter(e.to_string()))?;
            return Ok(());
        }

        let rate_limit_decision = {
            let mut limiter = self.rate_limiter.lock().await;
            limiter.check_and_record(&msg.user_id)
        };

        if let RateLimitDecision::Denied { retry_after_secs } = rate_limit_decision {
            adapter
                .send(OutboundMessage {
                    target_user_id: msg.user_id,
                    target_channel_id: msg.channel_id,
                    text: format!("{RATE_LIMIT_MESSAGE_PREFIX} {retry_after_secs}s."),
                })
                .await
                .map_err(|e| GatewayError::Adapter(e.to_string()))?;
            return Ok(());
        }

        let session_id = self
            .session_router
            .session_id_for(&msg.adapter, &msg.user_id);
        let response = daemon.send_chat(session_id, msg.text).await?;

        adapter
            .send(OutboundMessage {
                target_user_id: msg.user_id,
                target_channel_id: msg.channel_id,
                text: response,
            })
            .await
            .map_err(|e| GatewayError::Adapter(e.to_string()))?;

        Ok(())
    }
}

/// Message handler that binds runtime, adapter, and daemon client.
pub struct RuntimeHandler<C: NowProvider> {
    runtime: Arc<GatewayRuntime<C>>,
    adapter: Arc<dyn BotAdapter>,
    daemon: Mutex<Box<dyn DaemonClientApi>>,
}

impl<C: NowProvider> RuntimeHandler<C> {
    /// Build runtime handler.
    pub fn new(
        runtime: Arc<GatewayRuntime<C>>,
        adapter: Arc<dyn BotAdapter>,
        daemon: Box<dyn DaemonClientApi>,
    ) -> Self {
        Self {
            runtime,
            adapter,
            daemon: Mutex::new(daemon),
        }
    }
}

#[async_trait]
impl<C: NowProvider> GatewayHandler for RuntimeHandler<C> {
    async fn on_message(&self, msg: InboundMessage) {
        let target_user_id = msg.user_id.clone();
        let target_channel_id = msg.channel_id.clone();

        let outcome = {
            let mut daemon = self.daemon.lock().await;
            self.runtime
                .process_message(&mut **daemon, self.adapter.as_ref(), msg)
                .await
        };

        if let Err(err) = outcome {
            error!(error = %err, "gateway message processing failed");
            let _ = self
                .adapter
                .send(OutboundMessage {
                    target_user_id,
                    target_channel_id,
                    text: INTERNAL_ERROR_MESSAGE.to_string(),
                })
                .await;
        }
    }
}
