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


class ThoughtToolRequest(TypedDict):
    """A pseudo-tool request for updating the internal thought signature."""
    type: Literal["thought"]
    signature: str


ToolRequest = ActionToolRequest | IdentityToolRequest | SkillToolRequest | ThoughtToolRequest


# Configuration
class YipsConfig(TypedDict, total=False):
    """User configuration for Yips CLI."""
    backend: Literal["claude", "llamacpp"]
    model: str
    verbose: bool
    streaming: bool
    max_depth: int


# Session State for ReAct loop
class SessionState(TypedDict, total=False):
    """Internal state tracking for the current agentic loop."""
    thought_signature: str  # The high-level plan or "thought" for this task
    error_count: int        # Number of consecutive errors encountered
    last_action: str        # The last tool/action attempted


# Tool call tracking during streaming
class StreamingToolCall(TypedDict, total=False):
    """A tool call being accumulated during streaming."""
    name: str
    input_json: str
