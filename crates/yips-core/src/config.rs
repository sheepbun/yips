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

impl Default for YipsConfig {
    fn default() -> Self {
        Self {
            llm: LlmConfig::default(),
            daemon: DaemonConfig::default(),
            agent: AgentConfig::default(),
            skills: SkillsConfig::default(),
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
    }

    #[test]
    fn config_roundtrip() {
        let config = YipsConfig::default();
        let serialized = toml::to_string(&config).unwrap();
        let deserialized: YipsConfig = toml::from_str(&serialized).unwrap();
        assert_eq!(deserialized.agent.max_rounds, config.agent.max_rounds);
    }
}
