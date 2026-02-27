//! Individual tool implementations.

pub mod edit_file;
pub mod grep;
pub mod list_dir;
pub mod read_file;
pub mod run_command;
pub mod write_file;

pub use edit_file::EditFileTool;
pub use grep::GrepTool;
pub use list_dir::ListDirTool;
pub use read_file::ReadFileTool;
pub use run_command::RunCommandTool;
pub use write_file::WriteFileTool;

use async_trait::async_trait;
use yips_core::tool::{ToolDefinition, ToolOutput};

/// Trait that all tools must implement.
#[async_trait]
pub trait Tool: Send + Sync {
    /// The unique name of the tool.
    fn name(&self) -> &str;

    /// A human-readable description of what the tool does.
    fn description(&self) -> &str;

    /// JSON Schema describing the tool's parameters.
    fn parameters_schema(&self) -> serde_json::Value;

    /// Execute the tool with the given arguments.
    async fn execute(&self, args: serde_json::Value) -> crate::Result<ToolOutput>;

    /// Return the full tool definition for LLM consumption.
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters_schema(),
        }
    }
}
