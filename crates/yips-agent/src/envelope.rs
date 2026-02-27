//! Envelope parser for LLM responses. Extracts tool calls from the assistant's
//! response, handling both native tool calling and text-based tool invocation.

use yips_core::message::ToolCall;

/// Parsed result from an LLM response envelope.
#[derive(Debug, Clone)]
pub struct ParsedEnvelope {
    /// Text content from the response (reasoning, explanation).
    pub text: String,
    /// Tool calls extracted from the response.
    pub tool_calls: Vec<ToolCall>,
}

impl ParsedEnvelope {
    /// Returns true if the response contains tool calls.
    pub fn has_tool_calls(&self) -> bool {
        !self.tool_calls.is_empty()
    }

    /// Returns true if this is a final response (no tool calls).
    pub fn is_final(&self) -> bool {
        self.tool_calls.is_empty()
    }
}

/// Parse an LLM response into text and tool calls.
///
/// This handles the native OpenAI-format tool calls that come from the
/// chat completion API. If the response includes `tool_calls` in the
/// structured response, those are used directly.
pub fn parse_envelope(content: &str, tool_calls: Option<Vec<ToolCall>>) -> ParsedEnvelope {
    ParsedEnvelope {
        text: content.to_string(),
        tool_calls: tool_calls.unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_final_response() {
        let envelope = parse_envelope("Hello, world!", None);
        assert!(envelope.is_final());
        assert_eq!(envelope.text, "Hello, world!");
    }

    #[test]
    fn parse_with_tool_calls() {
        let tool_calls = vec![ToolCall {
            id: "call_1".to_string(),
            name: "read_file".to_string(),
            arguments: r#"{"path": "/tmp/test.txt"}"#.to_string(),
        }];
        let envelope = parse_envelope("Let me read that file.", Some(tool_calls));
        assert!(envelope.has_tool_calls());
        assert_eq!(envelope.tool_calls.len(), 1);
        assert_eq!(envelope.tool_calls[0].name, "read_file");
    }
}
