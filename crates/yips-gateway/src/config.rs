//! Gateway-specific configuration helpers.

use std::collections::HashSet;
use std::path::PathBuf;

use yips_core::config::{DiscordTriggerMode, YipsConfig};

/// Normalized gateway settings used by runtime wiring.
#[derive(Debug, Clone)]
pub struct GatewaySettings {
    pub enabled: bool,
    pub daemon_socket_path: PathBuf,
    pub session_prefix: String,
    pub allow_user_ids: HashSet<String>,
    pub max_requests: u32,
    pub window_secs: u64,
    pub discord_enabled: bool,
    pub discord_token: Option<String>,
    pub discord_allowed_guild_ids: Vec<String>,
    pub discord_allow_dms: bool,
    pub discord_trigger_mode: DiscordTriggerMode,
    pub telegram_enabled: bool,
    pub telegram_token: Option<String>,
    pub telegram_allowed_chat_ids: Vec<String>,
}

impl GatewaySettings {
    /// Build normalized gateway settings from global config.
    pub fn from_config(config: &YipsConfig) -> Self {
        Self {
            enabled: config.gateway.enabled,
            daemon_socket_path: config
                .gateway
                .daemon_socket_path
                .clone()
                .unwrap_or_else(|| config.socket_path()),
            session_prefix: config.gateway.session.prefix.clone(),
            allow_user_ids: config.gateway.auth.allow_user_ids.iter().cloned().collect(),
            max_requests: config.gateway.rate_limit.max_requests,
            window_secs: config.gateway.rate_limit.window_secs,
            discord_enabled: config.gateway.discord.enabled,
            discord_token: config.gateway.discord.token.clone(),
            discord_allowed_guild_ids: config.gateway.discord.allowed_guild_ids.clone(),
            discord_allow_dms: config.gateway.discord.allow_dms,
            discord_trigger_mode: config.gateway.discord.trigger_mode.clone(),
            telegram_enabled: config.gateway.telegram.enabled,
            telegram_token: config.gateway.telegram.token.clone(),
            telegram_allowed_chat_ids: config.gateway.telegram.allowed_chat_ids.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yips_core::config::YipsConfig;

    #[test]
    fn from_config_threads_discord_trigger_mode_default() {
        let config = YipsConfig::default();
        let settings = GatewaySettings::from_config(&config);

        assert!(settings.discord_allow_dms);
        assert_eq!(
            settings.discord_trigger_mode,
            DiscordTriggerMode::AllMessages
        );
    }

    #[test]
    fn from_config_threads_discord_trigger_mode_mention_only() {
        let mut config = YipsConfig::default();
        config.gateway.discord.allow_dms = false;
        config.gateway.discord.trigger_mode = DiscordTriggerMode::MentionOnly;

        let settings = GatewaySettings::from_config(&config);
        assert!(!settings.discord_allow_dms);
        assert_eq!(
            settings.discord_trigger_mode,
            DiscordTriggerMode::MentionOnly
        );
    }

    #[test]
    fn from_config_threads_telegram_defaults() {
        let config = YipsConfig::default();
        let settings = GatewaySettings::from_config(&config);

        assert!(!settings.telegram_enabled);
        assert!(settings.telegram_token.is_none());
        assert!(settings.telegram_allowed_chat_ids.is_empty());
    }

    #[test]
    fn from_config_threads_telegram_custom_values() {
        let mut config = YipsConfig::default();
        config.gateway.telegram.enabled = true;
        config.gateway.telegram.token = Some("telegram-token".to_string());
        config.gateway.telegram.allowed_chat_ids = vec!["123".to_string(), "-100456".to_string()];

        let settings = GatewaySettings::from_config(&config);
        assert!(settings.telegram_enabled);
        assert_eq!(settings.telegram_token.as_deref(), Some("telegram-token"));
        assert_eq!(
            settings.telegram_allowed_chat_ids,
            vec!["123".to_string(), "-100456".to_string()]
        );
    }
}
