//! Skill directory scanning and discovery.

use std::path::{Path, PathBuf};

use tracing::{debug, warn};

use crate::error::{Result, SkillError};
use crate::manifest::SkillManifest;

/// Known executable filenames to look for inside a skill directory.
const EXECUTABLE_NAMES: &[&str] = &["run.py", "run.sh", "run.js", "run.ts", "run.rb", "run"];

/// A discovered skill with its manifest, executable path, and directory.
#[derive(Debug, Clone)]
pub struct Skill {
    /// The parsed manifest describing this skill.
    pub manifest: SkillManifest,
    /// Path to the executable file that implements this skill.
    pub executable_path: PathBuf,
    /// The skill's root directory (containing manifest.json).
    pub directory: PathBuf,
}

impl Skill {
    /// Convert this skill into a `ToolDefinition` so it can be presented to the LLM.
    pub fn to_tool_definition(&self) -> yips_core::tool::ToolDefinition {
        yips_core::tool::ToolDefinition {
            name: self.manifest.name.clone(),
            description: self.manifest.description.clone(),
            parameters: self.manifest.arguments.clone(),
        }
    }
}

/// Discovers skills by scanning directories for skill folders.
pub struct SkillDiscovery;

impl SkillDiscovery {
    /// Scan the given directories for skill folders containing a `manifest.json`
    /// and a recognized executable.
    ///
    /// Each entry in `dirs` is expected to be a directory whose immediate children
    /// are skill folders. For example:
    ///
    /// ```text
    /// skills/
    ///   weather/
    ///     manifest.json
    ///     run.py
    ///   calculator/
    ///     manifest.json
    ///     run.sh
    /// ```
    ///
    /// Errors in individual skill folders are logged and skipped rather than
    /// failing the entire discovery.
    pub async fn discover(dirs: &[PathBuf]) -> Result<Vec<Skill>> {
        let mut skills = Vec::new();

        for dir in dirs {
            if !dir.exists() {
                warn!(
                    "skill directory does not exist, skipping: {}",
                    dir.display()
                );
                continue;
            }

            let mut entries = tokio::fs::read_dir(dir).await?;

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                match Self::load_skill(&path).await {
                    Ok(skill) => {
                        debug!(
                            "discovered skill '{}' at {}",
                            skill.manifest.name,
                            path.display()
                        );
                        skills.push(skill);
                    }
                    Err(e) => {
                        warn!("skipping directory {}: {}", path.display(), e);
                    }
                }
            }
        }

        Ok(skills)
    }

    /// Load a single skill from a directory.
    pub async fn load_skill(dir: &Path) -> Result<Skill> {
        let manifest_path = dir.join("manifest.json");

        if !manifest_path.exists() {
            return Err(SkillError::ManifestNotFound(dir.to_path_buf()));
        }

        let manifest_bytes = tokio::fs::read(&manifest_path).await?;
        let manifest =
            SkillManifest::from_bytes(&manifest_bytes).map_err(|e| SkillError::ManifestParse {
                path: manifest_path.clone(),
                source: e,
            })?;

        let executable_path = Self::find_executable(dir)?;

        Ok(Skill {
            manifest,
            executable_path,
            directory: dir.to_path_buf(),
        })
    }

    /// Find a recognized executable file in the skill directory.
    fn find_executable(dir: &Path) -> Result<PathBuf> {
        for name in EXECUTABLE_NAMES {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
        Err(SkillError::ExecutableNotFound(dir.to_path_buf()))
    }
}
