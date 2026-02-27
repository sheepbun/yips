//! Tool registry that maps tool names to implementations.

use std::collections::HashMap;

use yips_core::tool::{ToolDefinition, ToolOutput};

use crate::error::{Result, ToolError};
use crate::tools::{
    EditFileTool, GrepTool, ListDirTool, ReadFileTool, RunCommandTool, Tool, WriteFileTool,
};

/// Registry of all available tools, keyed by name.
pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    /// Create a new registry pre-populated with all built-in tools.
    pub fn new() -> Self {
        let mut tools: HashMap<String, Box<dyn Tool>> = HashMap::new();

        let builtins: Vec<Box<dyn Tool>> = vec![
            Box::new(ReadFileTool),
            Box::new(WriteFileTool),
            Box::new(EditFileTool),
            Box::new(GrepTool),
            Box::new(RunCommandTool),
            Box::new(ListDirTool),
        ];

        for tool in builtins {
            tools.insert(tool.name().to_string(), tool);
        }

        Self { tools }
    }

    /// Look up a tool by name.
    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.get(name).map(|t| t.as_ref())
    }

    /// Return definitions for all registered tools (for LLM tool descriptions).
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().map(|t| t.definition()).collect()
    }

    /// Execute a tool by name with the given arguments.
    pub async fn execute(&self, name: &str, args: serde_json::Value) -> Result<ToolOutput> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| ToolError::UnknownTool(name.to_string()))?;
        tool.execute(args).await
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
