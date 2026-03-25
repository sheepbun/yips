"""
Type definitions for Yips CLI.

Provides TypedDict definitions for structured data used throughout the codebase.
"""

from typing import Any, Literal, TypedDict, Protocol, TYPE_CHECKING

if TYPE_CHECKING:
    from rich.console import Console, Group
    from pathlib import Path
    from prompt_toolkit.formatted_text.base import StyleAndTextTuples


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


class EditFileToolRequest(TypedDict):
    """A tool request for editing a file with diff preview."""
    type: Literal["action"]
    tool: Literal["edit_file"]
    params: str


ToolRequest = ActionToolRequest | IdentityToolRequest | SkillToolRequest | ThoughtToolRequest | EditFileToolRequest


# Configuration
class YipsConfig(TypedDict, total=False):
    """User configuration for Yips CLI."""
    backend: Literal["claude", "llamacpp"]
    model: str
    verbose: bool
    streaming: bool
    max_depth: int
    nicknames: dict[str, str]


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


class YipsAgentProtocol(Protocol):
    """Interface that YipsAgent mixins and commands need from the main agent."""
    conversation_history: list[Message]
    console: "Console"
    backend: str
    current_model: str | None
    verbose_mode: bool
    streaming_enabled: bool
    backend_initialized: bool
    use_claude_cli: bool
    token_limits: dict[str, int]
    running_summary: str
    archived_history: list[Message]
    session_file_path: "Path | None"
    session_created: bool
    current_session_name: str | None
    session_state: SessionState
    session_list: list[dict[str, Any]]
    session_selection_idx: int
    session_selection_active: bool
    thinking_lines_shown: int
    last_width: int
    last_stream_tps: float | None
    last_stream_status_text: str

    @property
    def is_gui(self) -> bool: ...

    def initialize_backend(self, silent: bool = False) -> None: ...
    def check_and_prune_context(self, additional_text: str = "") -> None: ...
    def force_prune_context(self, amount_tokens: int) -> None: ...
    def get_response(self, message: str) -> str: ...
    def call_llamacpp(self, message: str) -> str: ...
    def call_claude_cli(self, message: str) -> str: ...
    def emit_gui_event(self, event_type: str, data: Any) -> None: ...
    def load_context(self) -> str: ...
    def build_system_info(self) -> str: ...
    def estimate_tokens(self, system_prompt: str, messages: list[Message] | list[dict[str, Any]] | str) -> int: ...
    def stream_llamacpp(self, messages: list[dict[str, Any]]) -> str: ...
    def extract_thinking_points(self, thinking_text: str, is_streaming: bool = False) -> list[str]: ...
    def stream_claude_cli(self, full_prompt: str) -> str: ...
    def display_claude_tool_calls(self, stderr_output: str) -> None: ...
    def calculate_context_limits(self) -> None: ...
    def update_session_file(self) -> None: ...
    def generate_session_name_from_message(self) -> str: ...
    def refresh_display(self) -> None: ...
    def refresh_title_box_only(self) -> None: ...
    def render_title_box(self) -> None: ...
    def rename_session(self, new_name: str) -> None: ...
    def graceful_exit(self) -> None: ...
    def load_session(self, file_path: "Path") -> bool: ...
    def new_session(self) -> None: ...
    def get_title_box_group(self, scroll_offset: int = 0) -> "Group": ...
    def get_layout_mode(self, width: int) -> str: ...
    def render_minimal_title(self) -> None: ...
    def render_single_column_title(self, layout_mode: str) -> None: ...
    def get_two_column_title_group(self, scroll_step: int = 0) -> "Group": ...
    def get_model_info_string(self) -> str: ...
    def update_stream_status(self, output_tokens: int | None, duration_seconds: float) -> None: ...
    def format_stream_status(self, tps: float | None) -> str: ...
    def get_prompt_status_fragments(self) -> "StyleAndTextTuples": ...
    def replay_conversation_history(self) -> None: ...
