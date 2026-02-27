//! Telegram adapter implementation backed by teloxide polling.

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::{anyhow, bail, Context as AnyhowContext, Result};
use async_trait::async_trait;
use teloxide::payloads::GetUpdatesSetters;
use teloxide::prelude::{Bot, Requester};
use teloxide::requests::Request;
use teloxide::types::{ChatId, Message, UpdateKind};
use tracing::debug;

use crate::bot_adapter::{BotAdapter, GatewayHandler, InboundMessage, OutboundMessage};

const TELEGRAM_MAX_MESSAGE_CHARS: usize = 4096;

/// Telegram adapter configuration used by gateway wiring.
#[derive(Debug, Clone)]
pub struct TelegramAdapterConfig {
    pub token: String,
    pub allowed_chat_ids: Vec<String>,
}

/// Telegram adapter implementation.
#[derive(Debug, Clone)]
pub struct TelegramAdapter {
    bot: Bot,
    allowed_chat_ids: HashSet<i64>,
}

impl TelegramAdapter {
    /// Build a Telegram adapter from configuration.
    pub fn new(config: TelegramAdapterConfig) -> Result<Self> {
        let mut allowed_chat_ids = HashSet::new();
        for raw in config.allowed_chat_ids {
            let id =
                parse_chat_id(&raw).with_context(|| format!("invalid Telegram chat ID: {raw}"))?;
            allowed_chat_ids.insert(id);
        }

        Ok(Self {
            bot: Bot::new(config.token),
            allowed_chat_ids,
        })
    }
}

#[async_trait]
impl BotAdapter for TelegramAdapter {
    fn adapter_name(&self) -> &'static str {
        "telegram"
    }

    async fn run(&self, handler: Arc<dyn GatewayHandler>) -> Result<()> {
        let mut offset: i32 = 0;

        loop {
            let updates = self
                .bot
                .get_updates()
                .offset(offset)
                .timeout(30)
                .limit(100)
                .send()
                .await
                .context("failed to poll Telegram updates")?;

            for update in updates {
                offset = update.id + 1;

                if let UpdateKind::Message(msg) = update.kind {
                    if let Some(inbound) = extract_inbound_message(&msg, &self.allowed_chat_ids) {
                        handler.on_message(inbound).await;
                    }
                }
            }
        }
    }

    async fn send(&self, msg: OutboundMessage) -> Result<()> {
        let target_chat_id = resolve_send_target(&msg)?;
        let chunks = split_telegram_message_chunks(&msg.text, TELEGRAM_MAX_MESSAGE_CHARS);
        if chunks.is_empty() {
            bail!("refusing to send empty Telegram message");
        }

        let total = chunks.len();
        for (idx, chunk) in chunks.iter().enumerate() {
            self.bot
                .send_message(ChatId(target_chat_id), chunk.clone())
                .send()
                .await
                .with_context(|| {
                    format!(
                        "failed to send Telegram message chunk {}/{} to chat {}",
                        idx + 1,
                        total,
                        target_chat_id
                    )
                })?;
        }

        debug!(
            user_id = %msg.target_user_id,
            channel_id = ?msg.target_channel_id,
            text_len = msg.text.len(),
            chunks = chunks.len(),
            chat_id = target_chat_id,
            "sent Telegram outbound message"
        );

        Ok(())
    }
}

fn parse_chat_id(raw: &str) -> Result<i64> {
    raw.trim()
        .parse::<i64>()
        .map_err(|e| anyhow!("invalid Telegram ID `{raw}`: {e}"))
}

fn should_accept_message(
    author_is_bot: bool,
    content: &str,
    chat_id: i64,
    allowed_chat_ids: &HashSet<i64>,
) -> bool {
    if author_is_bot {
        return false;
    }

    if content.trim().is_empty() {
        return false;
    }

    if allowed_chat_ids.is_empty() {
        return false;
    }

    allowed_chat_ids.contains(&chat_id)
}

fn extract_inbound_message(
    msg: &Message,
    allowed_chat_ids: &HashSet<i64>,
) -> Option<InboundMessage> {
    let user = msg.from()?;
    let text = msg.text()?.trim();
    let chat_id = msg.chat.id.0;

    if !should_accept_message(user.is_bot, text, chat_id, allowed_chat_ids) {
        return None;
    }

    Some(map_inbound_message(user.id.0, chat_id, text.to_string()))
}

fn map_inbound_message(author_id: u64, chat_id: i64, content: String) -> InboundMessage {
    InboundMessage {
        adapter: "telegram".to_string(),
        user_id: author_id.to_string(),
        channel_id: Some(chat_id.to_string()),
        text: content,
    }
}

fn resolve_send_target(msg: &OutboundMessage) -> Result<i64> {
    if let Some(channel_id) = &msg.target_channel_id {
        return parse_chat_id(channel_id)
            .with_context(|| format!("invalid target_channel_id `{channel_id}`"));
    }

    parse_chat_id(&msg.target_user_id)
        .with_context(|| format!("invalid target_user_id `{}`", msg.target_user_id))
}

fn split_telegram_message_chunks(text: &str, max_chars: usize) -> Vec<String> {
    if max_chars == 0 {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut remaining = text.trim();

    while !remaining.is_empty() {
        let split_idx = char_boundary_index(remaining, max_chars);
        let window = &remaining[..split_idx];

        let chosen_idx = if split_idx < remaining.len() {
            window.rfind('\n').map_or(split_idx, |idx| idx + 1)
        } else {
            split_idx
        };

        let raw_chunk = &remaining[..chosen_idx];
        let chunk = raw_chunk.trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }

        remaining = remaining[chosen_idx..].trim_start();
    }

    chunks
}

fn char_boundary_index(input: &str, max_chars: usize) -> usize {
    if input.chars().count() <= max_chars {
        return input.len();
    }

    input
        .char_indices()
        .nth(max_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(input.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bot_adapter::OutboundMessage;

    fn allowed(ids: &[i64]) -> HashSet<i64> {
        ids.iter().copied().collect()
    }

    #[test]
    fn split_chunks_returns_empty_for_effectively_empty_text() {
        assert!(split_telegram_message_chunks("\n \n", TELEGRAM_MAX_MESSAGE_CHARS).is_empty());
    }

    #[test]
    fn split_chunks_enforces_hard_limit() {
        let text = "a".repeat(9_000);
        let chunks = split_telegram_message_chunks(&text, TELEGRAM_MAX_MESSAGE_CHARS);

        assert_eq!(chunks.len(), 3);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.chars().count() <= TELEGRAM_MAX_MESSAGE_CHARS));
    }

    #[test]
    fn split_chunks_prefers_newline_boundary() {
        let text = "12345\n67890abc";
        let chunks = split_telegram_message_chunks(text, 10);

        assert_eq!(chunks, vec!["12345".to_string(), "67890abc".to_string()]);
    }

    #[test]
    fn split_chunks_falls_back_to_hard_split_without_newline() {
        let chunks = split_telegram_message_chunks("abcdefghij", 5);
        assert_eq!(chunks, vec!["abcde".to_string(), "fghij".to_string()]);
    }

    #[test]
    fn empty_allowlist_rejects_all_messages() {
        assert!(!should_accept_message(false, "hello", 123, &allowed(&[])));
    }

    #[test]
    fn non_allowlisted_chat_is_rejected() {
        assert!(!should_accept_message(
            false,
            "hello",
            999,
            &allowed(&[123, 456])
        ));
    }

    #[test]
    fn allowlisted_chat_is_accepted() {
        assert!(should_accept_message(
            false,
            "hello",
            123,
            &allowed(&[123, 456])
        ));
    }

    #[test]
    fn bot_message_is_rejected() {
        assert!(!should_accept_message(true, "hello", 123, &allowed(&[123])));
    }

    #[test]
    fn empty_message_is_rejected() {
        assert!(!should_accept_message(false, "  ", 123, &allowed(&[123])));
    }

    #[test]
    fn mapping_uses_telegram_adapter_and_target_channel() {
        let inbound = map_inbound_message(42, -100777, "ping".to_string());

        assert_eq!(inbound.adapter, "telegram");
        assert_eq!(inbound.user_id, "42");
        assert_eq!(inbound.channel_id.as_deref(), Some("-100777"));
        assert_eq!(inbound.text, "ping");
    }

    #[test]
    fn outbound_target_prefers_channel_over_user_dm() {
        let msg = OutboundMessage {
            target_user_id: "123".to_string(),
            target_channel_id: Some("-100456".to_string()),
            text: "reply".to_string(),
        };

        let target = resolve_send_target(&msg).unwrap();
        assert_eq!(target, -100456);
    }

    #[test]
    fn outbound_target_reports_invalid_channel_id() {
        let msg = OutboundMessage {
            target_user_id: "123".to_string(),
            target_channel_id: Some("not-a-number".to_string()),
            text: "reply".to_string(),
        };

        let err = resolve_send_target(&msg).unwrap_err();
        assert!(err.to_string().contains("invalid target_channel_id"));
    }

    #[test]
    fn invalid_allowed_chat_id_fails_constructor() {
        let config = TelegramAdapterConfig {
            token: "token".to_string(),
            allowed_chat_ids: vec!["invalid".to_string()],
        };

        let err = TelegramAdapter::new(config).unwrap_err();
        assert!(err.to_string().contains("invalid Telegram chat ID"));
    }
}
