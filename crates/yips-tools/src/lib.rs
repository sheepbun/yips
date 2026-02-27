//! Tool implementations for the Yips AI agent.
//!
//! Provides a [`ToolRegistry`] that holds all built-in tools (read_file, write_file,
//! edit_file, grep, run_command, list_dir) and dispatches execution by name.

pub mod error;
pub mod registry;
pub mod tools;

pub use error::{Result, ToolError};
pub use registry::ToolRegistry;
pub use tools::Tool;
