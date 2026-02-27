//! Skill manifest parsing (manifest.json).

use serde::{Deserialize, Serialize};

/// A parsed skill manifest describing the skill's interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillManifest {
    /// Unique name of the skill.
    pub name: String,

    /// Human-readable description of what the skill does.
    pub description: String,

    /// JSON Schema describing the skill's accepted arguments.
    /// Expected to be an object schema with `type`, `properties`, and optionally `required`.
    pub arguments: serde_json::Value,

    /// Maximum execution time in seconds. Defaults to 30 if not specified.
    #[serde(default = "default_timeout")]
    pub timeout: u64,

    /// The interpreter used to run the skill's executable (e.g. "python3", "bash", "node").
    /// If not specified, the executable is run directly.
    #[serde(default)]
    pub interpreter: Option<String>,
}

fn default_timeout() -> u64 {
    30
}

impl SkillManifest {
    /// Parse a manifest from a JSON string.
    pub fn from_json(json: &str) -> std::result::Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Parse a manifest from a byte slice.
    pub fn from_bytes(bytes: &[u8]) -> std::result::Result<Self, serde_json::Error> {
        serde_json::from_slice(bytes)
    }
}
