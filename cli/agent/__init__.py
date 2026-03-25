"""
YipsAgent - Core agent class for Yips CLI.

Manages conversation, backend communication, and session state.
Refactored to use modular mixins for specialized functionality.
"""

import json
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any, cast, TYPE_CHECKING

if TYPE_CHECKING:
    from types import FrameType
    from prompt_toolkit import PromptSession
    from prompt_toolkit.application import Application

# Sentinel value returned by the prompt app when a terminal resize interrupts input
_RESIZE_SENTINEL = "__YIPS_RESIZE__"

from cli.color_utils import console
from cli.config import (
    load_config,
    CLAUDE_CLI_MODEL,
)
from cli.llamacpp import (
    LLAMA_DEFAULT_MODEL,
)
from cli.type_defs import Message, YipsConfig, SessionState

# Import modular mixins from the agent package
from .context import AgentContextMixin
from .session import AgentSessionMixin
from .ui import AgentUIMixin
from .backend import AgentBackendMixin


class YipsAgent(
    AgentContextMixin,
    AgentSessionMixin,
    AgentUIMixin,
    AgentBackendMixin
):
    """Main agent class managing conversation and autonomous tool execution."""

    def __init__(self, prompt_session: "PromptSession[str] | None" = None) -> None:
        self.conversation_history: list[Message] = []
        self.archived_history: list[Message] = []
        self.running_summary = ""
        self.console = console
        self.backend_initialized = False
        
        # Initialize loop state
        self.session_state: SessionState = {
            "thought_signature": "",
            "error_count": 0,
            "last_action": ""
        }

        # Load saved configuration
        config: YipsConfig = load_config()
        saved_model = config.get("model")
        saved_backend = config.get("backend")
        self.verbose_mode = config.get("verbose", True)
        self.streaming_enabled = config.get("streaming", True)

        # Terminal resize handling
        self.last_width: int = 0
        self.resize_pending: bool = False
        self._resize_timer: threading.Timer | None = None
        self._prompt_app: "Application[str] | None" = None

        self.session_file_path: Path | None = None
        self.session_created = False
        self.current_session_name: str | None = None
        self.thinking_lines_shown = 0
        self.last_stream_tps: float | None = None
        self.last_stream_status_text = ""

        # Interactive session selection state
        self.session_selection_active = False
        self.session_selection_idx = 0
        self.session_list: list[dict[str, Any]] = []

        # Prompt toolkit session for triggering redraws
        self.prompt_session = prompt_session

        # Register SIGWINCH handler (Unix only)
        if hasattr(signal, 'SIGWINCH'):
            signal.signal(signal.SIGWINCH, self._handle_resize)

        # Windows: poll for terminal size changes (no SIGWINCH on Windows)
        if os.name == 'nt':
            self._start_windows_resize_poller()

        # Determine backend and model
        self.backend: str = saved_backend or "llamacpp"
        self.current_model: str | None = saved_model

        if self.backend == "claude":
            self.use_claude_cli = True
            if not self.current_model:
                self.current_model = CLAUDE_CLI_MODEL
            self.context_size = None
        else: # llamacpp (default and fallback for deprecated lmstudio)
            self.backend = "llamacpp"
            self.use_claude_cli = False
            if not self.current_model or cast(Any, saved_backend) == "lmstudio":
                # If was using deprecated lmstudio, switch to llamacpp default
                self.current_model = LLAMA_DEFAULT_MODEL
            
            # Calculate context size for UI display
            try:
                from cli.llamacpp import get_optimal_context_size
                self.context_size = get_optimal_context_size()
            except ImportError:
                self.context_size = None

        # Eagerly calculate token limits so the title box shows the correct max from the start
        self.calculate_context_limits()

    @property
    def is_gui(self) -> bool:
        return os.environ.get("YIPS_GUI_MODE") == "1"

    def emit_gui_event(self, event_type: str, data: Any) -> None:
        """Emit a structured JSON event for the Electron frontend."""
        if self.is_gui:
            event = {
                "type": event_type,
                "data": data,
                "timestamp": time.time()
            }
            print(f"__YIPS_JSON__{json.dumps(event)}")
            sys.stdout.flush()

    def graceful_exit(self) -> None:
        """Handle graceful exit and finalize session memory."""
        # Unload models and stop servers
        if not getattr(self, 'use_claude_cli', False):
            if self.backend == "llamacpp":
                from cli.llamacpp import stop_llamacpp
                stop_llamacpp()

        # Cancel any pending resize timer
        if self._resize_timer is not None:
            self._resize_timer.cancel()

        # Ensure the session file is updated one last time before exit
        if self.conversation_history:
            self.update_session_file()

    def _start_windows_resize_poller(self) -> None:
        """Start a daemon thread that polls for terminal size changes on Windows."""
        def _poll() -> None:
            last_cols: int = 0
            while True:
                try:
                    cols = os.get_terminal_size().columns
                    if last_cols != 0 and cols != last_cols:
                        # Size changed — immediately clear to avoid wrap artifacts
                        print("\033[2J\033[H", end="", flush=True)
                        if self._resize_timer is not None:
                            self._resize_timer.cancel()
                        self._resize_timer = threading.Timer(0.15, self._trigger_resize)
                        self._resize_timer.start()
                    last_cols = cols
                except OSError:
                    pass
                time.sleep(0.1)

        t = threading.Thread(target=_poll, daemon=True)
        t.start()

    def _handle_resize(self, signum: int, frame: "FrameType | None") -> None:
        """Handle SIGWINCH signal with debouncing."""
        # Immediately clear screen to prevent line wrapping during resize
        print("\033[2J\033[H", end="", flush=True)

        if self._resize_timer is not None:
            self._resize_timer.cancel()
        self._resize_timer = threading.Timer(0.1, self._trigger_resize)
        self._resize_timer.start()

    def _trigger_resize(self) -> None:
        """Trigger resize: exit running prompt app (if any) or set pending flag."""
        if self._prompt_app is not None:
            try:
                self._prompt_app.exit(result=_RESIZE_SENTINEL)
            except Exception:
                self.resize_pending = True
        else:
            self.resize_pending = True
