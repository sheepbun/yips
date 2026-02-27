//! Grep tool: recursive regex search over files.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use regex::Regex;
use serde_json::json;
use yips_core::tool::ToolOutput;

use crate::error::{Result, ToolError};
use crate::tools::Tool;

/// Recursively searches file contents using a regular expression.
pub struct GrepTool;

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "grep"
    }

    fn description(&self) -> &str {
        "Search file contents with a regex pattern. Searches recursively through directories."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regular expression pattern to search for"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory to search in. Defaults to current directory."
                },
                "include": {
                    "type": "string",
                    "description": "Glob-style filter for file names (e.g. \"*.rs\")"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<ToolOutput> {
        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::MissingArg("pattern".into()))?;

        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");

        let include = args.get("include").and_then(|v| v.as_str());

        let re = Regex::new(pattern)?;

        let root = Path::new(path);
        if !root.exists() {
            return Err(ToolError::FileNotFound(path.to_string()));
        }

        // Collect all candidate files first (sync walk to avoid async recursion issues).
        let files = collect_files(root, include)?;

        let mut matches = Vec::new();
        const MAX_MATCHES: usize = 500;

        for file_path in &files {
            if matches.len() >= MAX_MATCHES {
                break;
            }
            let content = match tokio::fs::read_to_string(file_path).await {
                Ok(c) => c,
                Err(_) => continue, // skip unreadable / binary files
            };
            for (i, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    matches.push(format!("{}:{}:{}", file_path.display(), i + 1, line));
                    if matches.len() >= MAX_MATCHES {
                        break;
                    }
                }
            }
        }

        if matches.is_empty() {
            Ok(ToolOutput::ok("No matches found."))
        } else {
            let truncated = matches.len() >= MAX_MATCHES;
            let mut output = matches.join("\n");
            if truncated {
                output.push_str(&format!(
                    "\n\n(results truncated at {} matches)",
                    MAX_MATCHES
                ));
            }
            Ok(ToolOutput::ok(output))
        }
    }
}

/// Recursively collect all file paths under `root`, filtering by `include` glob.
/// Uses synchronous std::fs to avoid async recursion complexity.
fn collect_files(root: &Path, include: Option<&str>) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if root.is_file() {
        files.push(root.to_path_buf());
        return Ok(files);
    }
    collect_files_recursive(root, include, &mut files);
    Ok(files)
}

fn collect_files_recursive(dir: &Path, include: Option<&str>, files: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip hidden directories/files.
        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            collect_files_recursive(&path, include, files);
        } else if path.is_file() {
            if let Some(pattern) = include {
                if !glob_match(pattern, &name_str) {
                    continue;
                }
            }
            files.push(path);
        }
    }
}

/// Simple glob matching that supports `*` as wildcard.
fn glob_match(pattern: &str, name: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    // Handle *.ext pattern (most common case).
    if let Some(ext) = pattern.strip_prefix("*.") {
        return name.ends_with(&format!(".{}", ext));
    }
    // Handle exact match.
    pattern == name
}
