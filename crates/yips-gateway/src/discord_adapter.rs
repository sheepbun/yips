//! Discord adapter implementation backed by Serenity.

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::{anyhow, bail, Context as AnyhowContext, Result};
use async_trait::async_trait;
use serenity::all::{
    ChannelId, Client, Context, EventHandler, GatewayIntents, GuildId, Http, Message, Ready, UserId,
};
use tokio::sync::RwLock;
use tracing::debug;
use yips_core::config::DiscordTriggerMode;

use crate::bot_adapter::{BotAdapter, GatewayHandler, InboundMessage, OutboundMessage};

const DISCORD_MAX_MESSAGE_CHARS: usize = 2000;

/// Discord adapter configuration used by gateway wiring.
#[derive(Debug, Clone)]
pub struct DiscordAdapterConfig {
    pub token: String,
    pub allowed_guild_ids: Vec<String>,
    pub allow_dms: bool,
    pub trigger_mode: DiscordTriggerMode,
}

#[derive(Debug, Default)]
struct AdapterState {
    http: RwLock<Option<Arc<Http>>>,
}

/// Discord adapter implementation.
#[derive(Debug)]
pub struct DiscordAdapter {
    token: String,
    allowed_guild_ids: HashSet<GuildId>,
    allow_dms: bool,
    trigger_mode: DiscordTriggerMode,
    state: Arc<AdapterState>,
}

impl DiscordAdapter {
    /// Build a Discord adapter from configuration.
    pub fn new(config: DiscordAdapterConfig) -> Result<Self> {
        let mut allowed_guild_ids = HashSet::new();
        for raw in config.allowed_guild_ids {
            let id = parse_snowflake(&raw)
                .with_context(|| format!("invalid Discord guild ID: {raw}"))?;
            allowed_guild_ids.insert(GuildId::new(id));
        }

        Ok(Self {
            token: config.token,
            allowed_guild_ids,
            allow_dms: config.allow_dms,
            trigger_mode: config.trigger_mode,
            state: Arc::new(AdapterState::default()),
        })
    }
}

#[async_trait]
impl BotAdapter for DiscordAdapter {
    fn adapter_name(&self) -> &'static str {
        "discord"
    }

    async fn run(&self, handler: Arc<dyn GatewayHandler>) -> Result<()> {
        let event_handler = DiscordEventHandler {
            handler,
            allowed_guild_ids: self.allowed_guild_ids.clone(),
            allow_dms: self.allow_dms,
            trigger_mode: self.trigger_mode.clone(),
            bot_user_id: Arc::new(RwLock::new(None)),
        };

        let intents = GatewayIntents::GUILD_MESSAGES
            | GatewayIntents::DIRECT_MESSAGES
            | GatewayIntents::MESSAGE_CONTENT;

        let mut client = Client::builder(&self.token, intents)
            .event_handler(event_handler)
            .await
            .context("failed to initialize Discord client")?;

        {
            let mut http = self.state.http.write().await;
            *http = Some(client.http.clone());
        }

        let start_result = client.start().await;

        {
            let mut http = self.state.http.write().await;
            *http = None;
        }

        start_result.context("discord adapter client exited with error")
    }

    async fn send(&self, msg: OutboundMessage) -> Result<()> {
        let http = {
            let guard = self.state.http.read().await;
            guard
                .as_ref()
                .cloned()
                .ok_or_else(|| anyhow!("discord adapter is not running"))?
        };

        let target = resolve_send_target(&msg)?;
        let chunks = split_discord_message_chunks(&msg.text, DISCORD_MAX_MESSAGE_CHARS);
        if chunks.is_empty() {
            bail!("refusing to send empty Discord message");
        }

        match target {
            SendTarget::Channel(channel_id) => {
                let total = chunks.len();
                for (idx, chunk) in chunks.iter().enumerate() {
                    channel_id
                        .say(http.as_ref(), chunk)
                        .await
                        .with_context(|| {
                            format!(
                                "failed to send Discord channel message chunk {}/{}",
                                idx + 1,
                                total
                            )
                        })?;
                }
            }
            SendTarget::User(user_id) => {
                let dm = user_id
                    .create_dm_channel(http.as_ref())
                    .await
                    .context("failed to create Discord DM channel")?;

                let total = chunks.len();
                for (idx, chunk) in chunks.iter().enumerate() {
                    dm.id.say(http.as_ref(), chunk).await.with_context(|| {
                        format!(
                            "failed to send Discord DM message chunk {}/{}",
                            idx + 1,
                            total
                        )
                    })?;
                }
            }
        }

        debug!(
            user_id = %msg.target_user_id,
            channel_id = ?msg.target_channel_id,
            text_len = msg.text.len(),
            chunks = chunks.len(),
            "sent Discord outbound message"
        );

        Ok(())
    }
}

#[derive(Clone)]
struct DiscordEventHandler {
    handler: Arc<dyn GatewayHandler>,
    allowed_guild_ids: HashSet<GuildId>,
    allow_dms: bool,
    trigger_mode: DiscordTriggerMode,
    bot_user_id: Arc<RwLock<Option<UserId>>>,
}

#[async_trait]
impl EventHandler for DiscordEventHandler {
    async fn ready(&self, _ctx: Context, ready: Ready) {
        let mut bot_user_id = self.bot_user_id.write().await;
        *bot_user_id = Some(ready.user.id);
    }

    async fn message(&self, _ctx: Context, msg: Message) {
        let bot_user_id = {
            let guard = self.bot_user_id.read().await;
            guard.map(|id| id.get())
        };
        let trigger_signals = derive_trigger_signals(&msg, bot_user_id);

        if !should_accept_message(
            &self.trigger_mode,
            msg.author.bot,
            &msg.content,
            msg.guild_id.map(|id| id.get()),
            &self.allowed_guild_ids,
            self.allow_dms,
            bot_user_id,
            trigger_signals.mentions_bot,
            trigger_signals.replies_to_bot,
        ) {
            return;
        }

        let inbound = map_inbound_message(msg.author.id.get(), msg.channel_id.get(), msg.content);

        self.handler.on_message(inbound).await;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SendTarget {
    Channel(ChannelId),
    User(UserId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TriggerSignals {
    mentions_bot: bool,
    replies_to_bot: bool,
}

fn parse_snowflake(raw: &str) -> Result<u64> {
    raw.trim()
        .parse::<u64>()
        .map_err(|e| anyhow!("invalid Discord ID `{raw}`: {e}"))
}

fn split_discord_message_chunks(text: &str, max_chars: usize) -> Vec<String> {
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

fn derive_trigger_signals(msg: &Message, bot_user_id: Option<u64>) -> TriggerSignals {
    let mentions_bot = bot_user_id
        .map(|id| msg.mentions.iter().any(|mention| mention.id.get() == id))
        .unwrap_or(false);
    let replies_to_bot = bot_user_id
        .map(|id| {
            msg.referenced_message
                .as_ref()
                .map(|message| message.author.id.get() == id)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    TriggerSignals {
        mentions_bot,
        replies_to_bot,
    }
}

fn should_accept_message(
    trigger_mode: &DiscordTriggerMode,
    author_is_bot: bool,
    content: &str,
    guild_id: Option<u64>,
    allowed_guild_ids: &HashSet<GuildId>,
    allow_dms: bool,
    bot_user_id: Option<u64>,
    mentions_bot: bool,
    replies_to_bot: bool,
) -> bool {
    if author_is_bot {
        return false;
    }

    if content.trim().is_empty() {
        return false;
    }

    if guild_id.is_none() && !allow_dms {
        return false;
    }

    let guild_allowed = match guild_id {
        None => true,
        Some(_) if allowed_guild_ids.is_empty() => true,
        Some(id) => allowed_guild_ids.contains(&GuildId::new(id)),
    };
    if !guild_allowed {
        return false;
    }

    if guild_id.is_none() {
        return true;
    }

    match trigger_mode {
        DiscordTriggerMode::AllMessages => true,
        DiscordTriggerMode::MentionOnly => {
            if bot_user_id.is_none() {
                return false;
            }
            mentions_bot || replies_to_bot
        }
    }
}

fn map_inbound_message(author_id: u64, channel_id: u64, content: String) -> InboundMessage {
    InboundMessage {
        adapter: "discord".to_string(),
        user_id: author_id.to_string(),
        channel_id: Some(channel_id.to_string()),
        text: content,
    }
}

fn resolve_send_target(msg: &OutboundMessage) -> Result<SendTarget> {
    if let Some(channel_id) = &msg.target_channel_id {
        let parsed = parse_snowflake(channel_id)
            .with_context(|| format!("invalid target_channel_id `{channel_id}`"))?;
        return Ok(SendTarget::Channel(ChannelId::new(parsed)));
    }

    let user_id = parse_snowflake(&msg.target_user_id)
        .with_context(|| format!("invalid target_user_id `{}`", msg.target_user_id))?;
    Ok(SendTarget::User(UserId::new(user_id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bot_adapter::OutboundMessage;
    use serde_json::json;
    use serenity::all::Message;

    fn allowed(ids: &[u64]) -> HashSet<GuildId> {
        ids.iter().copied().map(GuildId::new).collect()
    }

    fn fixture_user_json(id: u64, bot: bool) -> serde_json::Value {
        json!({
            "id": id.to_string(),
            "username": format!("user-{id}"),
            "global_name": serde_json::Value::Null,
            "avatar": serde_json::Value::Null,
            "bot": bot
        })
    }

    fn fixture_message(
        author_id: u64,
        guild_id: Option<u64>,
        mentions: Vec<u64>,
        referenced_author_id: Option<u64>,
    ) -> Message {
        let referenced = referenced_author_id.map(|id| {
            json!({
                "id": "2",
                "channel_id": "7",
                "author": fixture_user_json(id, true),
                "content": "parent",
                "timestamp": "2024-01-01T00:00:01+00:00",
                "edited_timestamp": serde_json::Value::Null,
                "tts": false,
                "mention_everyone": false,
                "mentions": [],
                "mention_roles": [],
                "mention_channels": [],
                "attachments": [],
                "embeds": [],
                "reactions": [],
                "nonce": serde_json::Value::Null,
                "pinned": false,
                "webhook_id": serde_json::Value::Null,
                "type": 0,
                "activity": serde_json::Value::Null,
                "application": serde_json::Value::Null,
                "application_id": serde_json::Value::Null,
                "message_reference": serde_json::Value::Null,
                "flags": serde_json::Value::Null,
                "referenced_message": serde_json::Value::Null,
                "message_snapshots": [],
                "interaction_metadata": serde_json::Value::Null,
                "thread": serde_json::Value::Null,
                "components": [],
                "sticker_items": [],
                "position": serde_json::Value::Null,
                "role_subscription_data": serde_json::Value::Null,
                "guild_id": guild_id.map(|id| id.to_string()),
                "member": serde_json::Value::Null,
                "poll": serde_json::Value::Null
            })
        });

        serde_json::from_value(json!({
            "id": "1",
            "channel_id": "7",
            "author": fixture_user_json(author_id, false),
            "content": "hello",
            "timestamp": "2024-01-01T00:00:00+00:00",
            "edited_timestamp": serde_json::Value::Null,
            "tts": false,
            "mention_everyone": false,
            "mentions": mentions.into_iter().map(|id| fixture_user_json(id, false)).collect::<Vec<_>>(),
            "mention_roles": [],
            "mention_channels": [],
            "attachments": [],
            "embeds": [],
            "reactions": [],
            "nonce": serde_json::Value::Null,
            "pinned": false,
            "webhook_id": serde_json::Value::Null,
            "type": 0,
            "activity": serde_json::Value::Null,
            "application": serde_json::Value::Null,
            "application_id": serde_json::Value::Null,
            "message_reference": serde_json::Value::Null,
            "flags": serde_json::Value::Null,
            "referenced_message": referenced,
            "message_snapshots": [],
            "interaction_metadata": serde_json::Value::Null,
            "thread": serde_json::Value::Null,
            "components": [],
            "sticker_items": [],
            "position": serde_json::Value::Null,
            "role_subscription_data": serde_json::Value::Null,
            "guild_id": guild_id.map(|id| id.to_string()),
            "member": serde_json::Value::Null,
            "poll": serde_json::Value::Null
        }))
        .unwrap()
    }

    #[test]
    fn split_chunks_returns_empty_for_effectively_empty_text() {
        assert!(split_discord_message_chunks("\n \n", DISCORD_MAX_MESSAGE_CHARS).is_empty());
    }

    #[test]
    fn split_chunks_enforces_hard_limit() {
        let text = "a".repeat(4_500);
        let chunks = split_discord_message_chunks(&text, DISCORD_MAX_MESSAGE_CHARS);

        assert_eq!(chunks.len(), 3);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.chars().count() <= DISCORD_MAX_MESSAGE_CHARS));
    }

    #[test]
    fn split_chunks_prefers_newline_boundary() {
        let text = "12345\n67890abc";
        let chunks = split_discord_message_chunks(text, 10);

        assert_eq!(chunks, vec!["12345".to_string(), "67890abc".to_string()]);
    }

    #[test]
    fn split_chunks_falls_back_to_hard_split_without_newline() {
        let chunks = split_discord_message_chunks("abcdefghij", 5);
        assert_eq!(chunks, vec!["abcde".to_string(), "fghij".to_string()]);
    }

    #[test]
    fn guild_filter_allows_dm_even_with_allowlist_when_enabled() {
        assert!(should_accept_message(
            &DiscordTriggerMode::AllMessages,
            false,
            "hello",
            None,
            &allowed(&[123, 456]),
            true,
            None,
            false,
            false,
        ));
    }

    #[test]
    fn dm_is_rejected_when_allow_dms_is_false() {
        assert!(!should_accept_message(
            &DiscordTriggerMode::AllMessages,
            false,
            "hello",
            None,
            &allowed(&[123, 456]),
            false,
            None,
            false,
            false,
        ));
    }

    #[test]
    fn all_messages_rejects_bot_author() {
        assert!(!should_accept_message(
            &DiscordTriggerMode::AllMessages,
            true,
            "hello",
            Some(123),
            &allowed(&[]),
            true,
            Some(42),
            true,
            true,
        ));
    }

    #[test]
    fn all_messages_rejects_empty_content() {
        assert!(!should_accept_message(
            &DiscordTriggerMode::AllMessages,
            false,
            "   ",
            Some(123),
            &allowed(&[]),
            true,
            Some(42),
            false,
            false,
        ));
    }

    #[test]
    fn guild_filter_blocks_unlisted_guild() {
        assert!(!should_accept_message(
            &DiscordTriggerMode::AllMessages,
            false,
            "hello",
            Some(999),
            &allowed(&[123, 456]),
            true,
            Some(42),
            false,
            false,
        ));
    }

    #[test]
    fn guild_filter_allows_listed_guild() {
        assert!(should_accept_message(
            &DiscordTriggerMode::AllMessages,
            false,
            "hello",
            Some(123),
            &allowed(&[123, 456]),
            true,
            Some(42),
            false,
            false,
        ));
    }

    #[test]
    fn mention_only_accepts_mention_in_guild() {
        assert!(should_accept_message(
            &DiscordTriggerMode::MentionOnly,
            false,
            "hello",
            Some(123),
            &allowed(&[]),
            true,
            Some(42),
            true,
            false,
        ));
    }

    #[test]
    fn mention_only_accepts_reply_to_bot_in_guild() {
        assert!(should_accept_message(
            &DiscordTriggerMode::MentionOnly,
            false,
            "hello",
            Some(123),
            &allowed(&[]),
            true,
            Some(42),
            false,
            true,
        ));
    }

    #[test]
    fn mention_only_rejects_guild_message_without_mention_or_reply() {
        assert!(!should_accept_message(
            &DiscordTriggerMode::MentionOnly,
            false,
            "hello",
            Some(123),
            &allowed(&[]),
            true,
            Some(42),
            false,
            false,
        ));
    }

    #[test]
    fn mention_only_rejects_guild_message_when_bot_identity_unknown() {
        assert!(!should_accept_message(
            &DiscordTriggerMode::MentionOnly,
            false,
            "hello",
            Some(123),
            &allowed(&[]),
            true,
            None,
            true,
            true,
        ));
    }

    #[test]
    fn mention_only_still_accepts_dm_when_enabled() {
        assert!(should_accept_message(
            &DiscordTriggerMode::MentionOnly,
            false,
            "hello",
            None,
            &allowed(&[123, 456]),
            true,
            None,
            false,
            false,
        ));
    }

    #[test]
    fn derive_trigger_signals_detects_mention() {
        let msg = fixture_message(100, Some(123), vec![42], None);
        let signals = derive_trigger_signals(&msg, Some(42));

        assert!(signals.mentions_bot);
        assert!(!signals.replies_to_bot);
    }

    #[test]
    fn derive_trigger_signals_detects_reply_to_bot() {
        let msg = fixture_message(100, Some(123), vec![], Some(42));
        let signals = derive_trigger_signals(&msg, Some(42));

        assert!(!signals.mentions_bot);
        assert!(signals.replies_to_bot);
    }

    #[test]
    fn derive_trigger_signals_returns_false_when_bot_identity_unknown() {
        let msg = fixture_message(100, Some(123), vec![42], Some(42));
        let signals = derive_trigger_signals(&msg, None);

        assert!(!signals.mentions_bot);
        assert!(!signals.replies_to_bot);
    }

    #[test]
    fn mapping_uses_discord_adapter_and_target_channel() {
        let inbound = map_inbound_message(42, 77, "ping".to_string());

        assert_eq!(inbound.adapter, "discord");
        assert_eq!(inbound.user_id, "42");
        assert_eq!(inbound.channel_id.as_deref(), Some("77"));
        assert_eq!(inbound.text, "ping");
    }

    #[test]
    fn outbound_target_prefers_channel_over_user_dm() {
        let msg = OutboundMessage {
            target_user_id: "123".to_string(),
            target_channel_id: Some("456".to_string()),
            text: "reply".to_string(),
        };

        let target = resolve_send_target(&msg).unwrap();
        assert_eq!(target, SendTarget::Channel(ChannelId::new(456)));
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
    fn invalid_allowed_guild_id_fails_constructor() {
        let config = DiscordAdapterConfig {
            token: "token".to_string(),
            allowed_guild_ids: vec!["not-a-number".to_string()],
            allow_dms: true,
            trigger_mode: DiscordTriggerMode::AllMessages,
        };

        let err = DiscordAdapter::new(config).unwrap_err();
        assert!(err.to_string().contains("invalid Discord guild ID"));
    }
}
