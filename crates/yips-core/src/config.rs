//! Configuration loading and types. Reads from `~/.config/yips/config.toml`.

use crate::error::{Result, YipsError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Top-level Yips configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct YipsConfig {
    pub llm: LlmConfig,
    pub daemon: DaemonConfig,
    pub agent: AgentConfig,
    pub skills: SkillsConfig,
    pub gateway: GatewayConfig,
}

/// Configuration for the llama.cpp backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LlmConfig {
    /// Base URL for the llama.cpp HTTP server.
    pub base_url: String,
    /// Model identifier to request.
    pub model: String,
    /// Maximum tokens to generate per response.
    pub max_tokens: u32,
    /// Sampling temperature.
    pub temperature: f32,
}

/// Configuration for the daemon process.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DaemonConfig {
    /// Path to the Unix domain socket.
    pub socket_path: Option<PathBuf>,
    /// Whether to auto-start llama.cpp server.
    pub auto_start_llm: bool,
    /// Path to the llama.cpp server binary.
    pub llama_server_path: Option<PathBuf>,
    /// Model file path for llama.cpp.
    pub model_path: Option<PathBuf>,
}

/// Configuration for the agent engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    /// Maximum number of ReAct rounds per turn.
    pub max_rounds: u32,
    /// Number of consecutive failures before pivoting strategy.
    pub failure_pivot_threshold: u32,
    /// System prompt template.
    pub system_prompt: Option<String>,
}

/// Configuration for skill discovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SkillsConfig {
    /// Additional directories to search for skills.
    pub extra_dirs: Vec<PathBuf>,
    /// Default timeout for skill execution in seconds.
    pub default_timeout_secs: u64,
}

/// Configuration for external gateway adapters (Discord, Telegram).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GatewayConfig {
    /// Whether gateway processing is enabled.
    pub enabled: bool,
    /// Optional override for the daemon socket path used by gateway clients.
    pub daemon_socket_path: Option<PathBuf>,
    /// Authentication policy for external users.
    pub auth: GatewayAuthConfig,
    /// Rate limiting policy for inbound gateway messages.
    pub rate_limit: GatewayRateLimitConfig,
    /// Session routing behavior for gateway users.
    pub session: GatewaySessionConfig,
    /// Discord adapter configuration.
    pub discord: DiscordConfig,
    /// Telegram adapter configuration.
    pub telegram: TelegramConfig,
}

/// Allowlist-based gateway authentication policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GatewayAuthConfig {
    /// Explicit user IDs allowed to talk to the gateway.
    /// Empty means all users are allowed.
    pub allow_user_ids: Vec<String>,
}

/// Sliding-window rate limit policy for inbound user messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GatewayRateLimitConfig {
    /// Maximum allowed requests per user in a rolling window.
    pub max_requests: u32,
    /// Rolling window size in seconds.
    pub window_secs: u64,
}

/// Session routing controls for gateway traffic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GatewaySessionConfig {
    /// Prefix included in generated daemon session IDs.
    pub prefix: String,
}

/// Discord adapter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DiscordConfig {
    /// Whether the Discord adapter is enabled.
    pub enabled: bool,
    /// Bot token, typically sourced from configuration or env expansion.
    pub token: Option<String>,
    /// Optional list of allowed guild IDs; empty allows all guilds.
    pub allowed_guild_ids: Vec<String>,
    /// Whether direct messages are accepted by the Discord adapter.
    pub allow_dms: bool,
    /// Inbound message trigger policy for Discord channels.
    pub trigger_mode: DiscordTriggerMode,
}

/// Telegram adapter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TelegramConfig {
    /// Whether the Telegram adapter is enabled.
    pub enabled: bool,
    /// Bot token, typically sourced from configuration or env expansion.
    pub token: Option<String>,
    /// Explicit allowlist of accepted chat IDs.
    pub allowed_chat_ids: Vec<String>,
}

/// Trigger policy for inbound Discord messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiscordTriggerMode {
    /// Process all non-bot, non-empty messages that pass guild policy.
    AllMessages,
    /// In guild channels, only process mentions/replies directed at the bot.
    MentionOnly,
}

impl Default for YipsConfig {
    fn default() -> Self {
        Self {
            llm: LlmConfig::default(),
            daemon: DaemonConfig::default(),
            agent: AgentConfig::default(),
            skills: SkillsConfig::default(),
            gateway: GatewayConfig::default(),
        }
    }
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:8080".to_string(),
            model: "default".to_string(),
            max_tokens: 4096,
            temperature: 0.7,
        }
    }
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            socket_path: None,
            auto_start_llm: false,
            llama_server_path: None,
            model_path: None,
        }
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_rounds: 6,
            failure_pivot_threshold: 2,
            system_prompt: None,
        }
    }
}

impl Default for SkillsConfig {
    fn default() -> Self {
        Self {
            extra_dirs: Vec::new(),
            default_timeout_secs: 30,
        }
    }
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            daemon_socket_path: None,
            auth: GatewayAuthConfig::default(),
            rate_limit: GatewayRateLimitConfig::default(),
            session: GatewaySessionConfig::default(),
            discord: DiscordConfig::default(),
            telegram: TelegramConfig::default(),
        }
    }
}

impl Default for GatewayAuthConfig {
    fn default() -> Self {
        Self {
            allow_user_ids: Vec::new(),
        }
    }
}

impl Default for GatewayRateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests: 8,
            window_secs: 60,
        }
    }
}

impl Default for GatewaySessionConfig {
    fn default() -> Self {
        Self {
            prefix: "gw".to_string(),
        }
    }
}

impl Default for DiscordConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: None,
            allowed_guild_ids: Vec::new(),
            allow_dms: true,
            trigger_mode: DiscordTriggerMode::default(),
        }
    }
}

impl Default for DiscordTriggerMode {
    fn default() -> Self {
        Self::AllMessages
    }
}

impl Default for TelegramConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: None,
            allowed_chat_ids: Vec::new(),
        }
    }
}

impl YipsConfig {
    /// Load configuration from the default path (`~/.config/yips/config.toml`),
    /// falling back to defaults if the file doesn't exist.
    pub fn load() -> Result<Self> {
        let path = Self::default_path()?;
        if path.exists() {
            let contents = std::fs::read_to_string(&path).map_err(|e| {
                YipsError::Config(format!(
                    "Failed to read config at {}: {}",
                    path.display(),
                    e
                ))
            })?;
            toml::from_str(&contents)
                .map_err(|e| YipsError::Config(format!("Invalid config: {}", e)))
        } else {
            Ok(Self::default())
        }
    }

    /// Load configuration from a specific path.
    pub fn load_from(path: &std::path::Path) -> Result<Self> {
        let contents = std::fs::read_to_string(path).map_err(|e| {
            YipsError::Config(format!(
                "Failed to read config at {}: {}",
                path.display(),
                e
            ))
        })?;
        toml::from_str(&contents).map_err(|e| YipsError::Config(format!("Invalid config: {}", e)))
    }

    /// Returns the default config file path.
    pub fn default_path() -> Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| YipsError::Config("Could not determine config directory".into()))?;
        Ok(config_dir.join("yips").join("config.toml"))
    }

    /// Returns the default socket path, respecting `$XDG_RUNTIME_DIR`.
    pub fn socket_path(&self) -> PathBuf {
        if let Some(ref p) = self.daemon.socket_path {
            return p.clone();
        }
        if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
            PathBuf::from(runtime_dir).join("yips").join("daemon.sock")
        } else {
            PathBuf::from("/tmp").join("yips").join("daemon.sock")
        }
    }

    /// Returns the skill directories to search (global + project-local + extras).
    pub fn skill_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if let Some(config_dir) = dirs::config_dir() {
            dirs.push(config_dir.join("yips").join("skills"));
        }
        dirs.push(PathBuf::from(".yips").join("skills"));
        dirs.extend(self.skills.extra_dirs.clone());
        dirs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        let config = YipsConfig::default();
        assert_eq!(config.agent.max_rounds, 6);
        assert_eq!(config.llm.base_url, "http://127.0.0.1:8080");
        assert!(!config.gateway.enabled);
        assert_eq!(config.gateway.rate_limit.max_requests, 8);
    }

    #[test]
    fn config_roundtrip() {
        let config = YipsConfig::default();
        let serialized = toml::to_string(&config).unwrap();
        let deserialized: YipsConfig = toml::from_str(&serialized).unwrap();
        assert_eq!(deserialized.agent.max_rounds, config.agent.max_rounds);
        assert!(deserialized.gateway.discord.allow_dms);
        assert_eq!(
            deserialized.gateway.discord.trigger_mode,
            DiscordTriggerMode::AllMessages
        );
        assert!(!deserialized.gateway.telegram.enabled);
        assert!(deserialized.gateway.telegram.allowed_chat_ids.is_empty());
    }

    #[test]
    fn telegram_config_parses_fields() {
        let config: YipsConfig = toml::from_str(
            r#"
                [gateway]
                [gateway.telegram]
                enabled = true
                token = "telegram-token"
                allowed_chat_ids = ["123", "-100456"]
            "#,
        )
        .unwrap();

        assert!(config.gateway.telegram.enabled);
        assert_eq!(
            config.gateway.telegram.token.as_deref(),
            Some("telegram-token")
        );
        assert_eq!(
            config.gateway.telegram.allowed_chat_ids,
            vec!["123".to_string(), "-100456".to_string()]
        );
    }

    #[test]
    fn discord_allow_dms_parses_false() {
        let config: YipsConfig = toml::from_str(
            r#"
                [gateway]
                [gateway.discord]
                allow_dms = false
            "#,
        )
        .unwrap();

        assert!(!config.gateway.discord.allow_dms);
    }

    #[test]
    fn discord_trigger_mode_parses_mention_only() {
        let config: YipsConfig = toml::from_str(
            r#"
                [gateway]
                [gateway.discord]
                trigger_mode = "mention_only"
            "#,
        )
        .unwrap();

        assert_eq!(
            config.gateway.discord.trigger_mode,
            DiscordTriggerMode::MentionOnly
        );
    }

    #[test]
    fn discord_trigger_mode_rejects_invalid_value() {
        let err = toml::from_str::<YipsConfig>(
            r#"
                [gateway]
                [gateway.discord]
                trigger_mode = "invalid_mode"
            "#,
        )
        .unwrap_err();

        assert!(err.to_string().contains("unknown variant"));
    }
}
