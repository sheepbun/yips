//! Skill discovery and execution for the Yips agent system.
//!
//! Skills are external scripts (Python, Bash, Node, etc.) that extend the agent's
//! capabilities. Each skill lives in its own directory with a `manifest.json`
//! describing its interface and a `run.*` executable implementing it.
//!
//! Communication uses a JSON stdin/stdout protocol: the runner writes a request
//! object to the skill's stdin and reads a response object from its stdout.

pub mod discovery;
pub mod error;
pub mod manifest;
pub mod runner;

pub use discovery::{Skill, SkillDiscovery};
pub use error::SkillError;
pub use manifest::SkillManifest;
pub use runner::{SkillContext, SkillResponse, SkillRunner, SkillStatus};
