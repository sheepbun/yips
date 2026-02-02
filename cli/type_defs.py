"""
Type definitions for Yips CLI.

Provides TypedDict definitions for structured data used throughout the codebase.
"""

from typing import Any, Literal, TypedDict


# Message for conversation history
class Message(TypedDict):
    """A message in the conversation history."""
    role: Literal["user", "assistant", "system"]
    content: str


# Tool request types (discriminated union)
class ActionToolRequest(TypedDict):
    """A tool request for executing an action."""
    type: Literal["action"]
    tool: str
    params: str


class IdentityToolRequest(TypedDict):
    """A tool request for updating identity."""
    type: Literal["identity"]
    reflection: str


class SkillToolRequest(TypedDict):
    """A tool request for invoking a skill."""
    type: Literal["skill"]
    skill: str
    args: str


ToolRequest = ActionToolRequest | IdentityToolRequest | SkillToolRequest


# Configuration
class YipsConfig(TypedDict, total=False):
    """User configuration for Yips CLI."""
    backend: Literal["claude", "lmstudio"]
    model: str
    verbose: bool
    streaming: bool


# LM Studio response content blocks
class TextContentBlock(TypedDict):
    """A text content block from LM Studio response."""
    type: Literal["text"]
    text: str


class ToolUseContentBlock(TypedDict):
    """A tool use content block from LM Studio response."""
    type: Literal["tool_use"]
    name: str
    input: dict[str, Any]


ContentBlock = TextContentBlock | ToolUseContentBlock


# Tool call tracking during streaming
class StreamingToolCall(TypedDict, total=False):
    """A tool call being accumulated during streaming."""
    name: str
    input_json: str
