"""
YipsAgent - Core agent class for Yips CLI.

Manages conversation, backend communication, and session state.
"""

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from types import FrameType

import requests
from rich.live import Live
from rich.panel import Panel
from rich.text import Text
from rich.tree import Tree

from cli.color_utils import (
    console,
    gradient_text,
    apply_gradient_to_text,
    get_yips_prefix,
    print_gradient,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    interpolate_color,
)
from cli.config import (
    BASE_DIR,
    MEMORIES_DIR,
    SKILLS_DIR,
    load_config,
    LAYOUT_FULL_MIN_WIDTH,
    LAYOUT_SINGLE_MIN_WIDTH,
    LAYOUT_COMPACT_MIN_WIDTH,
)
from cli.lmstudio import (
    LM_STUDIO_URL,
    LM_STUDIO_MODEL,
    CLAUDE_CLI_PATH,
    CLAUDE_CLI_MODEL,
    is_lmstudio_running,
    ensure_lmstudio_running,
)
from cli.info_utils import (
    get_username,
    get_recent_activity,
    get_friendly_backend_name,
    get_friendly_model_name,
    get_display_directory,
)
from cli.ui_rendering import (
    PulsingSpinner,
    generate_yips_logo,
    safe_center,
    show_loading,
    render_top_border,
    render_bottom_border,
    LOGO_WIDTH,
)
from cli.type_defs import Message, YipsConfig, StreamingToolCall


class YipsAgent:
    """Main agent class managing conversation and autonomous tool execution."""

    def __init__(self) -> None:
        self.conversation_history: list[Message] = []
        self.console = console
        self.backend_initialized = False

        # Load saved configuration
        config: YipsConfig = load_config()
        saved_model = config.get("model")
        saved_backend = config.get("backend")
        self.verbose_mode = config.get("verbose", True)  # Show tool calls by default
        self.streaming_enabled = config.get("streaming", True)  # Enable streaming by default

        # Terminal resize handling
        self.last_width: int | None = None
        self.resize_pending: bool = False
        self._resize_timer: threading.Timer | None = None

        # Session file tracking for live memory creation
        self.session_file_path: Path | None = None
        self._session_created = False

        # Register SIGWINCH handler (Unix only)
        if hasattr(signal, 'SIGWINCH'):
            signal.signal(signal.SIGWINCH, self._handle_resize)

        # Determine backend and model from saved config or defaults
        # Do NOT start LM Studio here - that happens in initialize_backend() after title box display
        if saved_backend == "claude" and saved_model:
            self.use_claude_cli = True
            self.current_model = saved_model
        elif saved_backend == "lmstudio" and saved_model:
            self.use_claude_cli = False
            self.current_model = saved_model
        else:
            # No saved config - use defaults
            self.use_claude_cli = False
            self.current_model = LM_STUDIO_MODEL

    def initialize_backend(self) -> None:
        """Initialize backend after UI is displayed."""
        if self.backend_initialized:
            return

        # If using Claude CLI, nothing to initialize
        if self.use_claude_cli:
            self.backend_initialized = True
            return

        # LM Studio backend - ensure it's running
        if not is_lmstudio_running():
            self.console.print(f"[dim]Starting {get_friendly_backend_name('lmstudio')}...[/dim]")
            if not ensure_lmstudio_running():
                self.console.print(f"[yellow]{get_friendly_backend_name('lmstudio')} unavailable, using {get_friendly_backend_name('claude')}.[/yellow]")
                self.use_claude_cli = True
                self.current_model = CLAUDE_CLI_MODEL

        self.backend_initialized = True

    def load_context(self) -> str:
        """Load all context documents into a system prompt."""
        sections: list[str] = []

        # Soul document
        agent_md = BASE_DIR / "AGENT.md"
        if agent_md.exists():
            sections.append(f"# SOUL DOCUMENT\n\n{agent_md.read_text()}")

        # Identity
        identity_md = BASE_DIR / "IDENTITY.md"
        if identity_md.exists():
            sections.append(f"# IDENTITY\n\n{identity_md.read_text()}")

        # Human info
        human_md = BASE_DIR / "author" / "HUMAN.md"
        if human_md.exists():
            sections.append(f"# ABOUT KATHERINE\n\n{human_md.read_text()}")

        # Specifications
        specs_md = BASE_DIR / "system" / "SPECIFICATIONS.md"
        if specs_md.exists():
            sections.append(f"# SPECIFICATIONS\n\n{specs_md.read_text()}")

        # Recent memories (last 5)
        if MEMORIES_DIR.exists():
            memories = sorted(MEMORIES_DIR.glob("*.md"), reverse=True)[:5]
            if memories:
                mem_content: list[str] = []
                for mem in memories:
                    mem_content.append(f"## {mem.stem}\n{mem.read_text()}")
                sections.append(f"# RECENT MEMORIES\n\n" + "\n\n".join(mem_content))

        # Available skills
        if SKILLS_DIR.exists():
            skills = list(SKILLS_DIR.glob("*.py"))
            if skills:
                skill_names = [s.stem for s in skills]
                sections.append(
                    f"# AVAILABLE SKILLS\n\nYou can invoke: {', '.join(skill_names)}"
                )

        return "\n\n" + "=" * 60 + "\n\n".join(sections)

    def call_lm_studio(self, message: str) -> str:
        """Call LM Studio API using Anthropic-compatible endpoint."""
        system_prompt = self.load_context()

        # Build messages (exclude system role - it's separate in Anthropic format)
        messages: list[Message] = []
        for msg in self.conversation_history:
            if msg["role"] in ("user", "assistant"):
                messages.append({"role": msg["role"], "content": msg["content"]})

        # Only append 'message' if it's not already the last message in history
        # (prevents duplication in run loop while supporting one-off prompts)
        if not messages or messages[-1]["content"] != message:
            messages.append({"role": "user", "content": message})

        headers = {
            "Content-Type": "application/json",
        }

        # If streaming is enabled, use streaming mode
        if self.streaming_enabled:
            try:
                return self._stream_lm_studio(system_prompt, messages)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")
                # Fall through to non-streaming mode

        try:
            # Show loading spinner
            with show_loading("Waiting for LM Studio response..."):
                response = requests.post(
                    f"{LM_STUDIO_URL}/v1/messages",
                    headers=headers,
                    json={
                        "model": self.current_model,
                        "system": system_prompt,
                        "messages": messages,
                        "max_tokens": 2048,
                    },
                    timeout=120
                )
                response.raise_for_status()
                data = response.json()

            # Anthropic format: {"content": [{"type": "text", "text": "..."}, {"type": "tool_use", ...}]}
            content_blocks = data.get("content", [])
            text_parts: list[str] = []

            # Process all content blocks
            for block in content_blocks:
                block_type = block.get("type", "")

                if block_type == "text":
                    text_parts.append(block.get("text", ""))
                elif block_type == "tool_use" and self.verbose_mode:
                    # Display tool use if verbose mode is enabled
                    tool_name = block.get("name", "unknown")
                    tool_input = block.get("input", {})
                    self._display_lm_studio_tool_call(tool_name, tool_input)

            # Return combined text (fallback to old format if no content blocks)
            if text_parts:
                return "\n".join(text_parts)
            elif content_blocks and content_blocks[0].get("text"):
                return content_blocks[0]["text"]
            else:
                return "[No text response from model]"

        except requests.exceptions.ConnectionError:
            return "[Error: Could not connect to LM Studio. Is it running?]"
        except requests.exceptions.Timeout:
            return "[Error: Request timed out after 120 seconds]"
        except Exception as e:
            return f"[Error calling LM Studio: {e}]"

    def call_claude_cli(self, message: str) -> str:
        """Fallback: Call Claude Code CLI (Priority 1)."""
        system_prompt = self.load_context()

        # Build history string from conversation_history
        history_parts: list[str] = []
        for msg in self.conversation_history:
            role = "User" if msg["role"] == "user" else "Assistant"
            history_parts.append(f"{role}: {msg['content']}")

        # Add the current message if it's not the last one in history
        if not self.conversation_history or self.conversation_history[-1]["content"] != message:
            history_parts.append(f"User: {message}")

        history_text = "\n\n".join(history_parts)
        full_prompt = f"{system_prompt}\n\n# CONVERSATION HISTORY\n\n{history_text}"

        # If streaming is enabled, use streaming mode
        if self.streaming_enabled:
            try:
                return self._stream_claude_cli(full_prompt)
            except Exception as e:
                self.console.print(f"[yellow]Streaming failed ({e}), using non-streaming mode[/yellow]")
                # Fall through to non-streaming mode

        try:
            # Build command with optional verbose flag
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", self.current_model]
            if self.verbose_mode:
                cmd.append("--verbose")

            # Show loading spinner
            with show_loading("Waiting for Claude response..."):
                result = subprocess.run(
                    cmd,
                    input=full_prompt,
                    capture_output=True,
                    text=True,
                    timeout=120
                )

            # Display stderr (contains tool calls and debug info) if verbose mode is on
            if self.verbose_mode and result.stderr:
                self._display_claude_tool_calls(result.stderr)

            if result.returncode == 0:
                return result.stdout.strip()
            return f"[Error from Claude CLI: {result.stderr}]"
        except subprocess.TimeoutExpired:
            return "[Error: Claude CLI timed out after 120 seconds]"
        except Exception as e:
            return f"[Error calling Claude CLI: {e}]"

    def _stream_lm_studio(self, system_prompt: str, messages: list[Message]) -> str:
        """Stream response from LM Studio API with real-time display."""
        headers = {
            "Content-Type": "application/json",
        }

        try:
            # Display with Live for real-time updates
            prefix = get_yips_prefix()
            spinner = PulsingSpinner("Thinking...")

            response = requests.post(
                f"{LM_STUDIO_URL}/v1/messages",
                headers=headers,
                json={
                    "model": self.current_model,
                    "system": system_prompt,
                    "messages": messages,
                    "max_tokens": 2048,
                    "stream": True,
                },
                timeout=120,
                stream=True
            )
            response.raise_for_status()

            # Accumulate response text
            accumulated_text = ""
            tool_calls: list[StreamingToolCall] = []

            with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
                for line in response.iter_lines():
                    if not line:
                        continue

                    # Decode SSE format
                    line_str = line.decode('utf-8').strip()

                    # Skip 'event: ...' lines
                    if line_str.startswith('event:'):
                        continue

                    if not line_str.startswith('data:'):
                        continue

                    data_str = line_str[5:].strip()  # Remove 'data:' prefix
                    if data_str == '[DONE]':
                        break

                    try:
                        data = json.loads(data_str)
                        event_type = data.get("type", "")

                        if event_type == "content_block_delta":
                            delta = data.get("delta", {})
                            delta_type = delta.get("type", "")

                            if delta_type == "text_delta":
                                # Accumulate text tokens
                                text = delta.get("text", "")
                                accumulated_text += text

                                # Update display with full gradient (include prefix)
                                display_text = Text()
                                display_text.append_text(prefix)

                                lines = accumulated_text.split('\n')
                                for i, text_line in enumerate(lines):
                                    if i > 0:
                                        display_text.append("\n      ")
                                    display_text.append(apply_gradient_to_text(text_line))

                                live.update(display_text)

                            elif delta_type == "input_json_delta":
                                # Accumulate JSON for tool call
                                partial_json = delta.get("partial_json", "")
                                if tool_calls:
                                    current_tool = tool_calls[-1]
                                    if "input_json" not in current_tool:
                                        current_tool["input_json"] = ""
                                    current_tool["input_json"] += partial_json

                                # Update display to show tool usage activity
                                display_text = Text()
                                display_text.append_text(prefix)
                                if accumulated_text:
                                    lines = accumulated_text.split('\n')
                                    for i, text_line in enumerate(lines):
                                        if i > 0: display_text.append("\n      ")
                                        display_text.append(apply_gradient_to_text(text_line))
                                    display_text.append("\n      ")

                                tool_name = tool_calls[-1].get("name", "tool")
                                display_text.append(f"🔧 Using tool: {tool_name}...", style="cyan dim")
                                live.update(display_text)

                        elif event_type == "content_block_start":
                            block = data.get("content_block", {})
                            if block.get("type") == "tool_use":
                                tool_name = block.get("name", "unknown")
                                # Initialize tool call object
                                tool_calls.append({
                                    "name": tool_name,
                                    "input_json": ""
                                })

                                # Update display to show tool call started
                                display_text = Text()
                                display_text.append_text(prefix)
                                if accumulated_text:
                                    lines = accumulated_text.split('\n')
                                    for i, text_line in enumerate(lines):
                                        if i > 0: display_text.append("\n      ")
                                        display_text.append(apply_gradient_to_text(text_line))
                                    display_text.append("\n      ")

                                display_text.append(f"🔧 Using tool: {tool_name}...", style="cyan dim")
                                live.update(display_text)

                    except json.JSONDecodeError:
                        continue

            # Print final output after Live exits (so it persists)
            if accumulated_text:
                final_text = Text()
                final_text.append_text(prefix)
                lines = accumulated_text.split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        final_text.append("\n      ")
                    final_text.append(gradient_text(line))
                self.console.print(final_text)

            # Display tool calls after streaming completes
            if self.verbose_mode and tool_calls:
                for tool_call in tool_calls:
                    tool_name = tool_call.get("name", "unknown")
                    input_json = tool_call.get("input_json", "{}")
                    tool_input: dict[str, Any]
                    try:
                        tool_input = json.loads(input_json) if input_json else {}
                    except json.JSONDecodeError:
                        tool_input = {"error": "Invalid JSON in tool call", "raw": input_json}
                    self._display_lm_studio_tool_call(tool_name, tool_input)

            return accumulated_text if accumulated_text else "[No text response from model]"

        except requests.exceptions.ConnectionError:
            return "[Error: Could not connect to LM Studio. Is it running?]"
        except requests.exceptions.Timeout:
            return "[Error: Request timed out after 120 seconds]"
        except Exception as e:
            return f"[Error streaming from LM Studio: {e}]"

    def _stream_claude_cli(self, full_prompt: str) -> str:
        """Stream response from Claude CLI with real-time display."""
        try:
            # Build command with optional verbose flag
            cmd = [CLAUDE_CLI_PATH, "-p", "--model", self.current_model]
            if self.verbose_mode:
                cmd.append("--verbose")

            # Use Popen for streaming
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1  # Line buffered
            )

            # Send input (stdin is guaranteed to be non-None when stdin=PIPE)
            assert process.stdin is not None
            process.stdin.write(full_prompt)
            process.stdin.close()

            # Accumulate response
            accumulated_text = ""
            stderr_output = ""

            # Display with Live for real-time updates
            prefix = get_yips_prefix()
            spinner = PulsingSpinner("Thinking...")

            # stdout/stderr are guaranteed non-None when stdout=PIPE, stderr=PIPE
            assert process.stdout is not None
            assert process.stderr is not None

            with Live(spinner, console=self.console, refresh_per_second=20, transient=True) as live:
                while True:
                    # Read one character at a time for maximum responsiveness
                    char = process.stdout.read(1)
                    if not char and process.poll() is not None:
                        break

                    if not char:
                        time.sleep(0.01)
                        continue

                    accumulated_text += char

                    # Update display with full gradient (include prefix)
                    display_text = Text()
                    display_text.append_text(prefix)

                    lines = accumulated_text.split('\n')
                    for i, text_line in enumerate(lines):
                        if i > 0:
                            display_text.append("\n      ")
                        display_text.append(apply_gradient_to_text(text_line))

                    live.update(display_text)

            # Print final output after Live exits (so it persists)
            if accumulated_text:
                final_text = Text()
                final_text.append_text(prefix)
                lines = accumulated_text.split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        final_text.append("\n      ")
                    final_text.append(gradient_text(line))
                self.console.print(final_text)

            # Collect stderr
            stderr_output = process.stderr.read()
            process.wait()

            # Display tool calls if verbose mode is on
            if self.verbose_mode and stderr_output:
                self._display_claude_tool_calls(stderr_output)

            if process.returncode == 0:
                return accumulated_text.strip()
            return f"[Error from Claude CLI: {stderr_output}]"

        except Exception as e:
            return f"[Error streaming from Claude CLI: {e}]"

    def get_response(self, message: str) -> str:
        """Get response using available backend (LM Studio or Claude CLI)."""
        if not self.backend_initialized:
            return "[Error: Backend not initialized]"

        if self.use_claude_cli:
            return self.call_claude_cli(message)

        response = self.call_lm_studio(message)
        # If LM Studio fails mid-session, fall back to CLI
        if response.startswith("[Error: Could not connect"):
            self.console.print(f"[yellow]{get_friendly_backend_name('lmstudio')} disconnected, switching to {get_friendly_backend_name('claude')}.[/yellow]")
            self.use_claude_cli = True
            return self.call_claude_cli(message)
        return response

    def generate_session_summary(self) -> str:
        """Generate a short summary of the conversation for the session filename."""
        if not self.conversation_history:
            return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

        # Build a summary prompt
        summary_prompt = (
            "Summarize this conversation in 3-5 words for a filename. "
            "Use lowercase words separated by underscores. No special characters. "
            "Example: 'fixing_memorize_naming' or 'debugging_api_errors'. "
            "Respond with ONLY the filename slug, nothing else."
        )

        try:
            # Call the AI with the summary prompt
            response = self.get_response(summary_prompt)

            # Sanitize the response
            slug = response.strip().lower()
            slug = re.sub(r'[^a-z0-9_\s]', '', slug)
            slug = re.sub(r'[\s]+', '_', slug)
            slug = slug[:50]  # Limit length

            if slug:
                return slug
        except Exception:
            # If summary generation fails, fall back to timestamp
            pass

        # Fallback to timestamp-based name
        return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

    def _generate_session_name_from_message(self) -> str:
        """Generate session name from first user message."""
        # Find first user message in history
        for entry in self.conversation_history:
            if entry.get("role") == "user":
                message = entry.get("content", "")
                # Clean and truncate
                slug = message.lower().strip()
                # Remove non-alphanumeric (except spaces)
                slug = re.sub(r'[^a-z0-9\s]', '', slug)
                # Replace spaces with underscores
                slug = re.sub(r'\s+', '_', slug)
                # Truncate to 50 chars
                slug = slug[:50]
                # Remove trailing underscores
                slug = slug.rstrip('_')
                return slug if slug else "session"
        return "session"

    def update_session_file(self) -> None:
        """Create or update the session memory file with current conversation."""
        if not self.conversation_history:
            return

        # Create session file on first message if it doesn't exist
        if not self._session_created:
            self._session_created = True
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            # Generate meaningful name from first user message
            safe_name = self._generate_session_name_from_message()
            filename = f"{timestamp}_{safe_name}.md"
            self.session_file_path = MEMORIES_DIR / filename

        if not self.session_file_path:
            return

        # Ensure directory exists
        MEMORIES_DIR.mkdir(parents=True, exist_ok=True)

        # Format conversation for file
        conversation_lines = []
        for entry in self.conversation_history:
            role = entry.get("role", "unknown")
            content = entry.get("content", "")

            if role == "user":
                conversation_lines.append(f"**Katherine**: {content}")
            elif role == "assistant":
                conversation_lines.append(f"**Yips**: {content}")
            elif role == "system":
                # Truncate long system messages
                preview = content[:200] + "..." if len(content) > 200 else content
                conversation_lines.append(f"*[System: {preview}]*")

        memory_content = f"""# Session Memory

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Type**: Ongoing Session

## Conversation

{chr(10).join(conversation_lines)}

---
*Last updated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}*
"""

        try:
            self.session_file_path.write_text(memory_content)
        except Exception as e:
            self.console.print(f"[dim]Note: Could not update session file: {e}[/dim]")

    def _display_claude_tool_calls(self, stderr_output: str) -> None:
        """Parse and display Claude Code tool calls from stderr using Rich Tree."""
        lines = stderr_output.split('\n')

        # Collect tool-related lines to display with Tree
        tool_lines: list[str] = []
        for raw_line in lines:
            stripped_line = raw_line.strip()
            if not stripped_line:
                continue

            # Look for tool call indicators
            if 'Tool:' in stripped_line or 'tool:' in stripped_line or 'Reading' in stripped_line or 'Writing' in stripped_line or 'Running' in stripped_line:
                tool_lines.append(stripped_line)

        # If we found tool calls, display them in a tree
        if tool_lines:
            tree = Tree("[cyan]Claude Code Tools[/cyan]")
            for tool_line in tool_lines:
                tree.add(f"[dim]{tool_line}[/dim]")
            panel = Panel(tree, title="Tool Calls", border_style="cyan dim", expand=False)
            self.console.print(panel)

    def _display_lm_studio_tool_call(self, tool_name: str, tool_input: dict[str, Any]) -> None:
        """Display LM Studio tool calls in a formatted way using Rich Tree."""
        tree = self._format_tool_call_tree(tool_name, tool_input)
        panel = Panel(tree, title="Tool Call", border_style="cyan dim", expand=False)
        self.console.print(panel)

    def _format_tool_call_tree(self, tool_name: str, tool_input: dict[str, Any]) -> Tree:
        """Build a Rich Tree structure for tool call display."""
        tree = Tree(f"[cyan]{tool_name}[/cyan]")

        if tool_input:
            for key, value in tool_input.items():
                # Truncate long values
                value_str = str(value)
                if len(value_str) > 80:
                    value_str = value_str[:77] + "..."
                tree.add(f"[dim]{key}:[/dim] {value_str}")

        return tree

    def graceful_exit(self) -> None:
        """Handle graceful exit and finalize session memory."""
        # Ensure the session file is updated one last time before exit
        if self.conversation_history:
            self.update_session_file()

        self.console.print()
        print_gradient("Goodbye!")

    def render_title_box(self) -> None:
        """Render the title box with responsive layout."""
        terminal_width = self.console.width
        self.last_width = terminal_width
        layout_mode = self._get_layout_mode(terminal_width)

        if layout_mode == "minimal":
            self._render_minimal_title()
        elif layout_mode in ("compact", "single"):
            self._render_single_column_title(layout_mode)
        else:
            self._render_two_column_title()

    def _render_minimal_title(self) -> None:
        """Render minimal title box for very narrow terminals (< 45 chars)."""
        terminal_width = self.console.width
        content_width = terminal_width - 2  # Account for │ borders

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        # Get info
        backend_key = "claude" if self.use_claude_cli else "lmstudio"
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        logo = generate_yips_logo()
        logo_width = len(logo[0]) if logo else 1

        # Determine if we can show the logo (need at least logo width + 2 for borders)
        show_logo = content_width >= LOGO_WIDTH

        # Build minimal content based on available width
        lines = [""]  # blank line

        if show_logo:
            lines.extend(logo)
        else:
            # Show abbreviated "YIPS" text instead
            lines.append("YIPS")

        model_info = f"{display_backend} · {display_model}"
        lines.append(model_info)
        lines.append("")  # blank line

        logo_height = len(logo) if show_logo else 0
        total_logo_cells = logo_height * logo_width if show_logo else 1

        for line_num, line_text in enumerate(lines):
            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Logo lines (indices 1-6) - only if showing logo
            if show_logo and 1 <= line_num <= 6:
                logo_line_index = line_num - 1
                centered_text = safe_center(line_text, content_width)
                padding_left = (content_width - len(line_text)) // 2 if len(line_text) <= content_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    if 0 <= col_index < logo_width:
                        cell_index = (logo_line_index * logo_width) + col_index
                        progress = cell_index / max(total_logo_cells - 1, 1)
                        if not char.isspace():
                            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                            styled_line.append(char, style=f"rgb({r},{g},{b})")
                        else:
                            styled_line.append(char)
                    else:
                        # Padding: extend gradient based on overall position in content_width
                        overall_progress = i / max(content_width - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif not show_logo and line_num == 1:
                # Abbreviated "YIPS" text - gradient bold
                centered_text = safe_center(line_text, content_width)
                yips_text = gradient_text(centered_text)
                yips_text.stylize("bold")
                styled_line.append(yips_text)
            elif (show_logo and line_num == 7) or (not show_logo and line_num == 2):
                # Model info - solid blue, truncated if needed
                centered_text = safe_center(line_text, content_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            else:
                styled_line.append(safe_center(line_text, content_width))

            styled_line.append("│", style=right_bar_style)
            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width)

    def _render_single_column_title(self, layout_mode: str) -> None:
        """Render single-column title box for narrow terminals (45-79 chars)."""
        terminal_width = self.console.width
        content_width = terminal_width - 2  # Account for │ borders

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        # Gather content
        username = get_username()
        backend_key = "claude" if self.use_claude_cli else "lmstudio"
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        cwd = get_display_directory()
        logo = generate_yips_logo()
        logo_width = len(logo[0]) if logo else 1

        # Check if we can show the logo
        show_logo = content_width >= LOGO_WIDTH

        # Build single column content
        welcome_msg = f"Welcome back {username}!" if layout_mode == "single" else f"Hi {username}!"
        lines = [
            "",  # [0] blank
            welcome_msg,  # [1]
            "",  # [2] blank
        ]

        if show_logo:
            lines.extend(logo)  # [3-8] logo lines
            model_info_index = 9
        else:
            lines.append("YIPS")  # [3] abbreviated text
            model_info_index = 4

        lines.append(f"{display_backend} · {display_model}")  # model info
        cwd_index = len(lines) if layout_mode == "single" else -1
        if layout_mode == "single":
            lines.append(cwd)
        lines.append("")  # blank padding

        logo_height = len(logo) if show_logo else 0
        total_logo_cells = logo_height * logo_width if show_logo else 1

        for line_num, line_text in enumerate(lines):
            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Logo lines (indices 3-8) - only if showing logo
            if show_logo and 3 <= line_num <= 8:
                logo_line_index = line_num - 3
                centered_text = safe_center(line_text, content_width)
                padding_left = (content_width - len(line_text)) // 2 if len(line_text) <= content_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    if 0 <= col_index < logo_width:
                        cell_index = (logo_line_index * logo_width) + col_index
                        progress = cell_index / max(total_logo_cells - 1, 1)
                        if not char.isspace():
                            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                            styled_line.append(char, style=f"rgb({r},{g},{b})")
                        else:
                            styled_line.append(char)
                    else:
                        # Padding: extend gradient based on overall position in content_width
                        overall_progress = i / max(content_width - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif not show_logo and line_num == 3:
                # Abbreviated "YIPS" text - gradient bold
                centered_text = safe_center(line_text, content_width)
                yips_text = gradient_text(centered_text)
                yips_text.stylize("bold")
                styled_line.append(yips_text)
            elif line_num == 1:  # Welcome message - gradient, bold
                centered_text = safe_center(line_text, content_width)
                welcome_text = gradient_text(centered_text)
                welcome_text.stylize("bold")
                styled_line.append(welcome_text)
            elif line_num == model_info_index:  # Model info - solid blue
                centered_text = safe_center(line_text, content_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == cwd_index and layout_mode == "single":  # CWD - gradient
                centered_text = safe_center(line_text, content_width)
                cwd_text = gradient_text(centered_text)
                styled_line.append(cwd_text)
            else:
                styled_line.append(safe_center(line_text, content_width))

            styled_line.append("│", style=right_bar_style)
            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width)

    def _render_two_column_title(self) -> None:
        """Render two-column title box for wide terminals (>= 80 chars)."""
        terminal_width = self.console.width

        # If logo width exceeds 50% of terminal, hide right column (render single-column)
        if LOGO_WIDTH > terminal_width * 0.5:
            self._render_single_column_title("single")
            return

        # Reserve space for borders and divider: │ + left + │ + right + │
        available_width = terminal_width - 3
        left_width = max(int(available_width * 0.45), 30)
        right_width = available_width - left_width

        # Gather content
        username = get_username()
        backend_key = "claude" if self.use_claude_cli else "lmstudio"
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        cwd = get_display_directory()
        logo = generate_yips_logo()
        logo_height = len(logo)
        logo_width = len(logo[0]) if logo else 1
        activity = get_recent_activity()

        # Build left column (12 lines)
        left_col = [
            "",  # [0] blank
            f"Welcome back {username}!",  # [1]
            "",  # [2] blank
        ]
        left_col.extend(logo)  # [3-8] logo lines (6 lines)
        left_col.append(f"{display_backend} · {display_model}")  # [9]
        left_col.append(cwd)  # [10]
        left_col.append("")  # [11] blank padding

        # Build right column
        verbose_status = "on" if self.verbose_mode else "off"
        streaming_status = "on" if self.streaming_enabled else "off"
        right_col = [
            "Tips for getting started",  # [0]
            "Type /model to switch models",  # [1]
            f"Type /verbose to toggle tool calls ({verbose_status})",  # [2]
            f"Type /stream to toggle streaming ({streaming_status})",  # [3]
            "Type /exit to leave",  # [4]
            "─" * right_width,  # [5] divider
            "Recent activity",  # [6]
        ]
        right_col.extend(activity)
        while len(right_col) < len(left_col):
            right_col.append("")

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Render content lines
        max_lines = max(len(left_col), len(right_col))

        # Calculate border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"

        middle_progress = (left_width + 1) / max(terminal_width - 1, 1)
        r_mid, g_mid, b_mid = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, middle_progress)
        divider_style = f"rgb({r_mid},{g_mid},{b_mid})"

        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        total_logo_cells = logo_height * logo_width
        for line_num in range(max_lines):
            left_text = left_col[line_num] if line_num < len(left_col) else ""
            right_text = right_col[line_num] if line_num < len(right_col) else ""

            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Left content with proper styling
            if line_num >= 3 and line_num <= 8:  # Logo lines - raster scan gradient
                logo_line_index = line_num - 3
                centered_text = safe_center(left_text, left_width)
                padding_left = (left_width - len(left_text)) // 2 if len(left_text) <= left_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    if 0 <= col_index < logo_width:
                        cell_index = (logo_line_index * logo_width) + col_index
                        progress = cell_index / max(total_logo_cells - 1, 1)

                        if not char.isspace():
                            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                            styled_line.append(char, style=f"rgb({r},{g},{b})")
                        else:
                            styled_line.append(char)
                    else:
                        # Padding: extend gradient based on overall position in left_width
                        overall_progress = i / max(left_width - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 1:  # Welcome message - gradient, bold
                centered_text = safe_center(left_text, left_width)
                welcome_text = gradient_text(centered_text)
                welcome_text.stylize("bold")
                styled_line.append(welcome_text)
            elif line_num == 9:  # Model info - solid blue
                centered_text = safe_center(left_text, left_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == 10:  # CWD - gradient
                centered_text = safe_center(left_text, left_width)
                cwd_text = gradient_text(centered_text)
                styled_line.append(cwd_text)
            else:
                centered_text = safe_center(left_text, left_width)
                styled_line.append(centered_text)

            # Divider bar
            styled_line.append("│", style=divider_style)

            # Right content with styling - truncate if needed
            def truncate_right(text: str) -> str:
                if len(text) > right_width:
                    return text[:right_width]
                return text.ljust(right_width)

            right_col_start_position = left_width + 2

            if line_num == 0:  # Tips header - gradient, bold
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b}) bold")
            elif 1 <= line_num <= 4:  # Commands - gradient
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 5:  # Divider line - gradient
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 6:  # Recent activity header - white bold
                styled_line.append(truncate_right(right_text), style="bright_white bold")
            elif line_num >= 7:  # Activity items - dim
                styled_line.append(truncate_right(right_text), style="dim")
            else:
                styled_line.append(truncate_right(right_text))

            # Right bar
            styled_line.append("│", style=right_bar_style)

            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width)

    def refresh_display(self) -> None:
        """Clear terminal and re-render title box."""
        subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
        self.render_title_box()

    def _handle_resize(self, signum: int, frame: "FrameType | None") -> None:
        """Handle SIGWINCH signal with debouncing."""
        # Immediately clear screen to prevent line wrapping during resize
        print("\033[2J\033[H", end="", flush=True)

        if self._resize_timer is not None:
            self._resize_timer.cancel()
        self._resize_timer = threading.Timer(0.1, self._trigger_resize)
        self._resize_timer.start()

    def _trigger_resize(self) -> None:
        """Set flag to trigger resize on next main loop iteration."""
        self.resize_pending = True

    def _get_layout_mode(self, width: int) -> str:
        """Determine layout mode based on terminal width."""
        if width >= LAYOUT_FULL_MIN_WIDTH:
            return "full"
        elif width >= LAYOUT_SINGLE_MIN_WIDTH:
            return "single"
        elif width >= LAYOUT_COMPACT_MIN_WIDTH:
            return "compact"
        else:
            return "minimal"

    def stream_text(self, text: str) -> None:
        """Simulate streaming for a static piece of text."""
        prefix = get_yips_prefix()

        accumulated = ""
        with Live("", console=self.console, refresh_per_second=20, transient=True) as live:
            for char in text:
                accumulated += char

                display_text = Text()
                display_text.append_text(prefix)

                lines = accumulated.split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        display_text.append("\n      ")
                    display_text.append(apply_gradient_to_text(line))

                live.update(display_text)
                time.sleep(0.02)  # Adjust for desired speed

        # Print final persistent output
        self.console.print(prefix, end="")
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if i == 0:
                self.console.print(gradient_text(line))
            else:
                self.console.print(gradient_text("      " + line))


