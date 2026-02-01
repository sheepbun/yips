#!/usr/bin/env python3
"""
Yips - Fully Autonomous Personal Desktop Agent

A conversational assistant powered by LM Studio API with persistent memory,
beautiful gradient CLI output, and autonomous tool execution.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Type aliases
RGBColor = tuple[int, int, int]
Message = dict[str, str]
ToolRequest = dict[str, Any]

import requests
from rich.console import Console
from rich.text import Text
from rich.panel import Panel
from rich.table import Table
from rich.tree import Tree
from rich.live import Live
from rich.spinner import Spinner
from prompt_toolkit import prompt as prompt_toolkit_prompt
from prompt_toolkit.formatted_text import HTML as HTMLText
from prompt_toolkit.styles import Style as PromptStyle

# =============================================================================
# Configuration
# =============================================================================

from root import PROJECT_ROOT

BASE_DIR = PROJECT_ROOT
MEMORIES_DIR = BASE_DIR / "memories"
SKILLS_DIR = BASE_DIR / "skills"
CONFIG_FILE = BASE_DIR / ".yips_config.json"

# Version - Automatically calculated from git commits
# Format: vYYYY.MM.DD-SHORTHASH (e.g., v2026.01.31-a3f52b9)
APP_NAME = "Yips"

# Import version dynamically from version.py
try:
    from version import __version__ as APP_VERSION
except ImportError:
    APP_VERSION = "1.0.0"

# Priority 0: LM Studio (local, free)
LM_STUDIO_URL = os.environ.get("LM_STUDIO_URL", "http://localhost:1234")
LM_STUDIO_MODELS_DIR = Path.home() / ".lmstudio" / "models"
LM_STUDIO_MODEL = os.environ.get("LM_STUDIO_MODEL", "lmstudio-community/gpt-oss-20b-GGUF")
LMS_CLI_PATH = os.environ.get("LMS_CLI_PATH", "/home/katherine/.lmstudio/bin/lms")
# Read LM Studio API key from installation
try:
    _lms_key_file = Path.home() / ".lmstudio" / ".internal" / "lms-key-2"
    if _lms_key_file.exists():
        LM_STUDIO_AUTH = _lms_key_file.read_text().strip()
    else:
        LM_STUDIO_AUTH = os.environ.get("LM_STUDIO_AUTH", "")
except:
    LM_STUDIO_AUTH = os.environ.get("LM_STUDIO_AUTH", "")
LM_STUDIO_APPIMAGE = os.environ.get("LM_STUDIO_APPIMAGE", "/home/katherine/Apps/LM-Studio.AppImage")

# Priority 1: Claude CLI (fallback)
CLAUDE_CLI_PATH = os.environ.get("CLAUDE_CLI_PATH", "/home/katherine/.local/bin/claude")
CLAUDE_CLI_MODEL = os.environ.get("CLAUDE_CLI_MODEL", "sonnet")

# Gradient colors: Deep strawberry pink -> Banana yellow -> Light blue raspberry
GRADIENT_PINK = (255, 20, 147)      # #FF1493
GRADIENT_YELLOW = (255, 225, 53)    # #FFE135
GRADIENT_BLUE = (137, 207, 240)     # #89CFF0

# User prompt color
PROMPT_COLOR = "#FFCCFF"


# =============================================================================
# Display Name Mappings
# =============================================================================

def get_friendly_backend_name(backend_name: str) -> str:
    """Convert internal backend name to display-friendly name."""
    mapping = {
        "claude": "Claude Pro",
        "lmstudio": "LM Studio",
    }
    return mapping.get(backend_name, backend_name)


def get_friendly_model_name(model_name: str) -> str:
    """Convert internal model name to display-friendly name."""
    mapping = {
        "haiku": "4.5 Haiku",
        "sonnet": "4.5 Sonnet",
        "opus": "4.5 Opus",
        "lmstudio-community/gpt-oss-20b-GGUF": "gpt-oss",
    }
    return mapping.get(model_name, model_name)

# Destructive commands that require confirmation
DESTRUCTIVE_PATTERNS = [
    r"rm\s+(-[rf]+\s+)*(/|~|\$HOME)",
    r"rm\s+-rf\s+",
    r"mkfs",
    r"dd\s+if=",
    r">\s*/dev/",
    r"chmod\s+-R\s+777\s+/",
    r":(){ :|:& };:",
]

console = Console()


# =============================================================================
# LM Studio Process Management
# =============================================================================

def is_lmstudio_running() -> bool:
    """Check if LM Studio API is responding."""
    try:
        response = requests.get(f"{LM_STUDIO_URL}/v1/models", timeout=0.5)
        return response.status_code == 200
    except:
        return False


def ensure_lmstudio_running() -> bool:
    """Start LM Studio headless server if not running and wait for it to be ready."""
    if is_lmstudio_running():
        return True

    # Check if AppImage daemon is running
    try:
        daemon_running = subprocess.run(
            ["pgrep", "-f", "LM-Studio.AppImage"],
            capture_output=True
        ).returncode == 0
    except:
        daemon_running = False

    # Start AppImage daemon if not running (required for lms CLI to work)
    if not daemon_running and os.path.exists(LM_STUDIO_APPIMAGE):
        subprocess.Popen(
            [LM_STUDIO_APPIMAGE],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        # Wait for daemon to initialize
        time.sleep(8)

    # Start headless server via lms CLI
    try:
        subprocess.run(
            [LMS_CLI_PATH, "server", "start"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15
        )
    except:
        return False

    # Wait for API to become available (up to 30 seconds)
    for _ in range(30):
        time.sleep(1)
        if is_lmstudio_running():
            return True

    return False


def get_available_models() -> list[str]:
    """Scan LM Studio models directory for available models."""
    models: list[str] = []
    if LM_STUDIO_MODELS_DIR.exists():
        for gguf in LM_STUDIO_MODELS_DIR.rglob("*.gguf"):
            model_path = gguf.parent.relative_to(LM_STUDIO_MODELS_DIR)
            models.append(str(model_path))
    return list(set(models))


# =============================================================================
# Color & Styling Functions
# =============================================================================

def interpolate_color(c1: RGBColor, c2: RGBColor, t: float) -> RGBColor:
    """Linearly interpolate between two RGB colors."""
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
    )


def gradient_text(text: str) -> Text:
    """Create gradient-colored text: pink -> yellow. Skips leading/trailing whitespace."""
    styled = Text()
    
    if not text:
        return styled

    # Find start and end of non-whitespace content
    stripped_l = text.lstrip()
    if not stripped_l:
        # String is all whitespace
        styled.append(text)
        return styled
        
    leading_ws_len = len(text) - len(stripped_l)
    leading_ws = text[:leading_ws_len]
    
    stripped_full = stripped_l.rstrip()
    trailing_ws_len = len(stripped_l) - len(stripped_full)
    trailing_ws = stripped_l[len(stripped_full):]
    
    content = stripped_full
    length = len(content)
    
    # Append leading whitespace
    styled.append(leading_ws)
    
    # Apply gradient to content
    for i, char in enumerate(content):
        progress = i / max(length - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        styled.append(char, style=f"rgb({r},{g},{b})")
        
    # Append trailing whitespace
    styled.append(trailing_ws)

    return styled


def apply_gradient_to_text(text: str) -> Text:
    """Apply pink->yellow gradient to text for streaming display."""
    return gradient_text(text)


# =============================================================================
# Title Box Helper Functions
# =============================================================================

def get_username() -> str:
    """Get user's preferred name from HUMAN.md, fallback to Katherine."""
    try:
        human_file = BASE_DIR / "author" / "HUMAN.md"
        if human_file.exists():
            content = human_file.read_text()
            # Look for "Preferred name/nickname" field
            for line in content.split('\n'):
                if line.startswith('**Preferred name/nickname**'):
                    # Extract content after the colon
                    match = re.search(r'\*\*Preferred name/nickname\*\*:\s*(.+?)(?:\n|$)', content)
                    if match:
                        name = match.group(1).strip()
                        if name and not name.startswith('<!--'):
                            return name
            # Fallback to Name field if preferred name is empty
            match = re.search(r'\*\*Name\*\*:\s*(.+?)(?:\n|$)', content)
            if match:
                return match.group(1).strip()
    except Exception:
        pass
    return "Katherine"


def get_recent_activity(limit: int = 3) -> list[str]:
    """Get recent activity from memories directory."""
    try:
        if not MEMORIES_DIR.exists():
            return ["No recent activity"]

        memory_files = sorted(
            MEMORIES_DIR.glob("*.md"),
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )[:limit]

        if not memory_files:
            return ["No recent activity"]

        activities = []
        for f in memory_files:
            # Parse filename format: 2026-01-31_03-56-21_file_editing_and_logging.md
            name = f.stem  # Remove .md extension
            parts = name.split('_', 2)

            if len(parts) >= 3:
                date_part = parts[0]  # YYYY-MM-DD
                # Rest is the title (parts[2] onwards, join with _)
                title = '_'.join(parts[2:])
                # Convert underscores to spaces and title case
                title = title.replace('_', ' ').title()
            else:
                # Fallback for old format
                date_part = f.stat().st_mtime
                title = name

            activities.append(f"{date_part}: {title}")

        return activities if activities else ["No recent activity"]
    except Exception:
        return ["No recent activity"]


def generate_yips_logo() -> list[str]:
    """Generate YIPS ASCII art (6 lines)."""
    return [
        "██╗   ██╗██╗██████╗ ███████╗",
        "╚██╗ ██╔╝██║██╔══██╗██╔════╝",
        " ╚████╔╝ ██║██████╔╝███████╗",
        "  ╚██╔╝  ██║██╔═══╝ ╚════██║",
        "   ██║   ██║██║     ███████║",
        "   ╚═╝   ╚═╝╚═╝     ╚══════╝"
    ]


def print_gradient(text: str) -> None:
    """Print text with gradient coloring."""
    console.print(gradient_text(text))


def print_yips(text: str) -> None:
    """Print Yips' response with gradient styling."""
    prefix = gradient_text("Yips: ")
    console.print(prefix, end="")

    # Print response lines with gradient
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if i == 0:
            console.print(gradient_text(line))
        else:
            console.print(gradient_text("      " + line))


# =============================================================================
# Configuration Persistence
# =============================================================================

def load_config() -> dict[str, str]:
    """Load saved configuration from file."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_config(config: dict[str, str]) -> None:
    """Save configuration to file."""
    try:
        CONFIG_FILE.write_text(json.dumps(config, indent=2))
    except OSError:
        pass


# =============================================================================
# Main Agent Class
# =============================================================================

class YipsAgent:
    """Main agent class managing conversation and autonomous tool execution."""

    def __init__(self):
        self.conversation_history: list[Message] = []
        self.console = console
        self.backend_initialized = False

        # Load saved configuration
        config = load_config()
        saved_model = config.get("model")
        saved_backend = config.get("backend")
        self.verbose_mode = config.get("verbose", True)  # Show tool calls by default
        self.streaming_enabled = config.get("streaming", True)  # Enable streaming by default

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
            with self._show_loading("Waiting for LM Studio response..."):
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
        history_parts = []
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
            with self._show_loading("Waiting for Claude response..."):
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
            tool_calls = []

            # Display with Live for real-time updates
            prefix = gradient_text("Yips: ")

            with Live("", console=self.console, refresh_per_second=20, transient=True) as live:
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
                self.console.print(prefix, end="")
                lines = accumulated_text.split('\n')
                for i, line in enumerate(lines):
                    if i == 0:
                        self.console.print(gradient_text(line))
                    else:
                        self.console.print(gradient_text("      " + line))

            # Display tool calls after streaming completes
            if self.verbose_mode and tool_calls:
                for tool_call in tool_calls:
                    tool_name = tool_call.get("name", "unknown")
                    input_json = tool_call.get("input_json", "{}")
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

            # Send input
            process.stdin.write(full_prompt)
            process.stdin.close()

            # Accumulate response
            accumulated_text = ""
            stderr_output = ""

            # Display with Live for real-time updates
            prefix = gradient_text("Yips: ")

            with Live("", console=self.console, refresh_per_second=20, transient=True) as live:
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
                self.console.print(prefix, end="")
                lines = accumulated_text.split('\n')
                for i, line in enumerate(lines):
                    if i == 0:
                        self.console.print(gradient_text(line))
                    else:
                        self.console.print(gradient_text("      " + line))

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
            pass

        # Fallback to timestamp-based name
        return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

    def parse_tool_requests(self, response: str) -> list[ToolRequest]:
        """Parse tool request tags from response text."""
        requests_list: list[ToolRequest] = []

        # Pattern: {ACTION:tool:params}
        action_pattern = r"\{ACTION:(\w+):([^}]*)\}"
        for match in re.finditer(action_pattern, response):
            requests_list.append({
                "type": "action",
                "tool": match.group(1),
                "params": match.group(2)
            })

        # Pattern: {UPDATE_IDENTITY:reflection}
        identity_pattern = r"\{UPDATE_IDENTITY:([^}]*)\}"
        for match in re.finditer(identity_pattern, response):
            requests_list.append({
                "type": "identity",
                "reflection": match.group(1)
            })

        return requests_list

    def is_destructive_command(self, command: str) -> bool:
        """Check if a command matches destructive patterns."""
        for pattern in DESTRUCTIVE_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                return True
        return False

    def confirm_action(self, description: str) -> bool:
        """Ask user for confirmation (only for destructive commands)."""
        self.console.print(f"\n[bold red]Warning: Destructive command detected![/bold red]")
        self.console.print(f"[yellow]{description}[/yellow]")
        self.console.print("Allow? ", style=PROMPT_COLOR, end="")
        response = input().strip().lower()
        return response in ("y", "yes")

    def log_action(self, description: str) -> None:
        """Log an autonomous action being taken."""
        self.console.print(f"  [dim italic][{description}][/dim italic]")

    def _display_claude_tool_calls(self, stderr_output: str) -> None:
        """Parse and display Claude Code tool calls from stderr using Rich Tree."""
        lines = stderr_output.split('\n')

        # Collect tool-related lines to display with Tree
        tool_lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Look for tool call indicators
            if 'Tool:' in line or 'tool:' in line or 'Reading' in line or 'Writing' in line or 'Running' in line:
                tool_lines.append(line)

        # If we found tool calls, display them in a tree
        if tool_lines:
            tree = Tree("[cyan]Claude Code Tools[/cyan]")
            for line in tool_lines:
                tree.add(f"[dim]{line}[/dim]")
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

    def _show_loading(self, message: str = "Waiting for response...") -> Live:
        """Create and return a Rich Live context with loading spinner."""
        spinner = Spinner("dots2", text=f"[dim]{message}[/dim]")
        return Live(spinner, console=self.console, transient=True)

    def execute_tool(self, request: ToolRequest) -> str:
        """Execute a tool request (autonomously unless destructive)."""

        if request["type"] == "action":
            tool: str = str(request["tool"])
            params: str = str(request["params"])

            if tool == "read_file":
                path = params.strip()
                self.log_action(f"reading: {path}")
                try:
                    content = Path(path).expanduser().read_text()
                    return f"[File contents of {path}]:\n{content}"
                except Exception as e:
                    return f"[Error reading file: {e}]"

            elif tool == "write_file":
                parts = params.split(":", 1)
                if len(parts) < 2:
                    return "[Error: write_file requires path:content]"
                path, content = parts[0].strip(), parts[1]
                self.log_action(f"writing: {path}")
                try:
                    p = Path(path).expanduser()
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(content)
                    return f"[File written: {path}]"
                except Exception as e:
                    return f"[Error writing file: {e}]"

            elif tool == "run_command":
                command = params.strip()

                # Check for destructive commands
                if self.is_destructive_command(command):
                    if not self.confirm_action(f"Run: {command}"):
                        return "[Command cancelled by user]"

                self.log_action(f"running: {command}")
                try:
                    result = subprocess.run(
                        command,
                        shell=True,
                        capture_output=True,
                        text=True,
                        timeout=60
                    )
                    output = result.stdout
                    if result.stderr:
                        output += f"\n[stderr]: {result.stderr}"
                    return f"[Command output]:\n{output}" if output else "[Command completed (no output)]"
                except subprocess.TimeoutExpired:
                    return "[Command timed out after 60 seconds]"
                except Exception as e:
                    return f"[Error running command: {e}]"

            else:
                return f"[Unknown tool: {tool}]"

        elif request["type"] == "identity":
            reflection: str = str(request["reflection"])
            self.log_action("updating identity")
            identity_path = BASE_DIR / "IDENTITY.md"
            try:
                content = identity_path.read_text() if identity_path.exists() else "# Yips Identity\n"
                timestamp = datetime.now().strftime("%Y-%m-%d")
                new_reflection = f"\n### [{timestamp}] Reflection\n{reflection}\n"
                identity_path.write_text(content + new_reflection)
                return "[Identity updated with new reflection]"
            except Exception as e:
                return f"[Error updating identity: {e}]"

        return "[Unknown request type]"

    def handle_model_command(self, args: str) -> None:
        """Handle the /model command to display or switch models."""
        args = args.strip()

        # Claude models that switch to Claude CLI
        claude_models = {"haiku", "sonnet", "opus"}

        # Get available LM Studio models
        lm_models = get_available_models()

        if not args:
            # Display model table
            table = Table(title="Available Models")
            table.add_column("Model", style="cyan")
            table.add_column("Backend", style="magenta")
            table.add_column("Status", style="green")

            # Claude models
            for model in ["haiku", "sonnet", "opus"]:
                is_current = self.use_claude_cli and self.current_model == model
                status = "← current" if is_current else ""
                table.add_row(get_friendly_model_name(model), get_friendly_backend_name("claude"), status)

            # LM Studio models
            for model in lm_models:
                is_current = not self.use_claude_cli and self.current_model == model
                status = "← current" if is_current else ""
                table.add_row(get_friendly_model_name(model), get_friendly_backend_name("lmstudio"), status)

            self.console.print(table)
            return

        # Switch model
        model_name = args.lower()

        if model_name in claude_models:
            self.use_claude_cli = True
            self.current_model = model_name
            config = load_config()
            config.update({"backend": "claude", "model": model_name, "verbose": self.verbose_mode})
            save_config(config)
            self.console.print(f"[green]Switched to {get_friendly_backend_name('claude')} with model: {get_friendly_model_name(model_name)}[/green]")
            self.refresh_display()
        elif args in lm_models or any(args.lower() in m.lower() for m in lm_models):
            # Find matching LM Studio model
            matched = args if args in lm_models else next(
                (m for m in lm_models if args.lower() in m.lower()), None
            )
            if matched:
                self.use_claude_cli = False
                self.current_model = matched
                config = load_config()
                config.update({"backend": "lmstudio", "model": matched, "verbose": self.verbose_mode})
                save_config(config)
                self.console.print(f"[green]Switched to {get_friendly_backend_name('lmstudio')} with model: {get_friendly_model_name(matched)}[/green]")
                self.refresh_display()
            else:
                self.console.print(f"[red]Model not found: {args}[/red]")
        else:
            self.console.print(f"[red]Model not found: {args}[/red]")
            self.console.print("[dim]Use /model to see available models[/dim]")

    def handle_slash_command(self, user_input: str) -> str | bool:
        """Handle slash commands. Returns 'exit' to quit, True if handled, False otherwise."""
        if not user_input.startswith("/"):
            return False

        # Parse command and args
        parts = user_input[1:].split(maxsplit=1)
        command = parts[0].lower() if parts else ""
        args = parts[1] if len(parts) > 1 else ""

        # Built-in commands
        if command in ("exit", "quit"):
            self.graceful_exit()
            return "exit"

        if command == "model":
            self.handle_model_command(args)
            return True

        if command == "verbose":
            # Toggle verbose mode
            self.verbose_mode = not self.verbose_mode
            config = load_config()
            config["verbose"] = self.verbose_mode
            save_config(config)
            status = "enabled" if self.verbose_mode else "disabled"
            self.console.print(f"[green]Verbose mode (Claude Code tool calls): {status}[/green]")
            return True

        if command == "stream":
            # Toggle streaming mode
            self.streaming_enabled = not self.streaming_enabled
            config = load_config()
            config["streaming"] = self.streaming_enabled
            save_config(config)
            status = "enabled" if self.streaming_enabled else "disabled"
            self.console.print(f"[green]Streaming mode: {status}[/green]")
            self.refresh_display()
            return True

        # Skill-based commands
        skill_path = SKILLS_DIR / f"{command.upper()}.py"
        if skill_path.exists():
            try:
                cmd = [sys.executable, str(skill_path)] + (args.split() if args else [])
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.stdout.strip():
                    print_gradient(result.stdout.strip())
                if result.stderr.strip():
                    self.console.print(f"[red]{result.stderr.strip()}[/red]")
            except subprocess.TimeoutExpired:
                self.console.print(f"[red]Command /{command} timed out[/red]")
            except Exception as e:
                self.console.print(f"[red]Error running /{command}: {e}[/red]")
            return True

        # Unknown command
        self.console.print(f"[red]Unknown command: /{command}[/red]")
        available = [s.stem.lower() for s in SKILLS_DIR.glob("*.py")]
        available.extend(["exit", "model", "verbose", "stream"])
        self.console.print(f"[dim]Available: /{', /'.join(sorted(available))}[/dim]")
        return True

    def clean_response(self, response: str) -> str:
        """Remove tool request tags from response for display."""
        cleaned = response
        cleaned = re.sub(r"\{ACTION:\w+:[^}]*\}", "", cleaned)
        cleaned = re.sub(r"\{UPDATE_IDENTITY:[^}]*\}", "", cleaned)
        return cleaned.strip()

    def graceful_exit(self) -> None:
        """Handle graceful exit with memory save via EXIT skill."""
        exit_skill = SKILLS_DIR / "EXIT.py"

        if exit_skill.exists() and self.conversation_history:
            # Generate a meaningful session name from the conversation
            session_name = self.generate_session_summary()
            history_json = json.dumps(self.conversation_history)
            try:
                result = subprocess.run(
                    [sys.executable, str(exit_skill), history_json, session_name],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if result.stdout.strip():
                    print_gradient(result.stdout.strip())
            except Exception as e:
                self.console.print(f"[dim]Exit error: {e}[/dim]")

        self.console.print()
        print_gradient("Goodbye!")

    def render_title_box(self) -> None:
        """Render the title box with two-column layout."""
        # Calculate dimensions based on actual console width
        terminal_width = self.console.width

        # Reserve space for borders and divider: │ + left + │ + right + │
        available_width = terminal_width - 3
        left_width = max(int(available_width * 0.45), 30)
        right_width = available_width - left_width

        # Gather content
        username = get_username()
        backend_key = "claude" if self.use_claude_cli else "lmstudio"
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        cwd = str(Path.home() / "Yips")  # ~/Yips representation
        logo = generate_yips_logo()
        activity = get_recent_activity(3)

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
        # Add activity lines (up to 3)
        right_col.extend(activity)
        # Pad right column to match left column length
        while len(right_col) < len(left_col):
            right_col.append("")

        # Render top border with gradient
        title_text = "Yips CLI"
        version_text = APP_VERSION
        title_length = len(title_text) + 1 + len(version_text)  # +1 for space
        border_available = terminal_width - title_length - 7  # 7 for ╭─── ╮
        if border_available < 0:
            border_available = 0

        # Build styled top border with ONE continuous gradient across border elements
        top_text = Text()
        position = 0  # Track absolute horizontal position

        # Opening border: "╭─── " at positions 0-4
        opening = "╭─── "
        for char in opening:
            progress = position / max(terminal_width - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            top_text.append(char, style=f"rgb({r},{g},{b})")
            position += 1

        # Title: "Yips CLI" with its own separate gradient (positions 5-12)
        for i, char in enumerate(title_text):
            title_progress = i / max(len(title_text) - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, title_progress)
            top_text.append(char, style=f"rgb({r},{g},{b})")
            position += 1

        # Space separator (position 13)
        top_text.append(" ")
        position += 1

        # Version: solid blue (positions 14+)
        r, g, b = GRADIENT_BLUE
        top_text.append(version_text, style=f"rgb({r},{g},{b})")
        position += len(version_text)

        # Closing border: continuing the gradient from current position
        closing = " " + "─" * max(border_available, 0) + "╮"
        for char in closing:
            progress = position / max(terminal_width - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            top_text.append(char, style=f"rgb({r},{g},{b})")
            position += 1

        self.console.print(top_text)

        # Render content lines
        max_lines = max(len(left_col), len(right_col))

        # Calculate side border colors based on horizontal position (calculated once before loop)
        available_width = terminal_width - 3  # Account for the three borders
        left_width = max(int(available_width * 0.45), 30)

        # Left border at position 0
        left_progress = 0.0
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, left_progress)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"

        # Middle divider at position (left_width + 1)
        middle_progress = (left_width + 1) / max(terminal_width - 1, 1)
        r_mid, g_mid, b_mid = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, middle_progress)
        divider_style = f"rgb({r_mid},{g_mid},{b_mid})"

        # Right border at position (terminal_width - 1)
        right_progress = 1.0
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, right_progress)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        for line_num in range(max_lines):
            left_text = left_col[line_num] if line_num < len(left_col) else ""
            right_text = right_col[line_num] if line_num < len(right_col) else ""

            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Left content with proper styling
            if line_num >= 3 and line_num <= 8:  # Logo lines - vertical pink to yellow gradient
                logo_line_index = line_num - 3  # Convert to 0-5 range

                # Center the text
                centered_text = left_text.center(left_width)

                # Apply smooth gradient per character for smooth color transitions
                for i, char in enumerate(centered_text):
                    # Line-based progress (0.0 = pink top, 1.0 = yellow bottom)
                    line_progress = logo_line_index / 5

                    # Character-based progress for smooth horizontal smoothing
                    # This adds subtle variation across each line for visual smoothness
                    char_progress = (i / max(len(centered_text) - 1, 1)) * (1/6) if len(centered_text) > 1 else 0

                    # Combine: primarily vertical gradient with subtle horizontal smoothing
                    gradient_progress = min(1.0, line_progress + char_progress)

                    # Interpolate color for this character
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, gradient_progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 1:  # Welcome message - pink to yellow gradient (centered)
                centered_text = left_text.center(left_width)
                styled_line.append(gradient_text(centered_text))
            elif line_num == 9:  # Model info - solid blue (centered)
                centered_text = left_text.center(left_width)
                r, g, b = GRADIENT_BLUE
                blue_style = f"rgb({r},{g},{b})"
                styled_line.append(centered_text, style=blue_style)
            elif line_num == 10:  # CWD - pink to yellow gradient (centered)
                centered_text = left_text.center(left_width)
                styled_line.append(gradient_text(centered_text))
            else:
                # Other left content - center aligned with default color
                centered_text = left_text.center(left_width)
                styled_line.append(centered_text)

            # Divider bar
            styled_line.append("│", style=divider_style)

            # Right content with styling
            right_col_start_position = left_width + 2
            
            if line_num <= 4:  # Tips and commands - gradient matching border
                padded_text = right_text.ljust(right_width)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 5:  # Divider line with flowing gradient
                padded_text = right_text.ljust(right_width)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 6:  # Recent activity header - white
                styled_line.append(right_text.ljust(right_width), style="bright_white")
            elif line_num >= 7:  # Activity items - dim
                styled_line.append(right_text.ljust(right_width), style="dim")
            else:
                styled_line.append(right_text.ljust(right_width))

            # Right bar
            styled_line.append("│", style=right_bar_style)

            self.console.print(styled_line)

        # Render bottom border with gradient
        bottom_border_str = "╰" + "─" * (terminal_width - 2) + "╯"
        bottom_text = Text()
        for i, char in enumerate(bottom_border_str):
            progress = i / max(len(bottom_border_str) - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            bottom_text.append(char, style=f"rgb({r},{g},{b})")

        self.console.print(bottom_text)
        self.console.print()

    def refresh_display(self) -> None:
        """Clear terminal and re-render title box."""
        os.system('clear' if os.name != 'nt' else 'cls')
        self.render_title_box()

    def stream_text(self, text: str) -> None:
        """Simulate streaming for a static piece of text."""
        prefix = gradient_text("Yips: ")
        
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

    def run(self):
        """Main conversation loop."""
        # Clear terminal
        os.system('clear' if os.name != 'nt' else 'cls')

        # Render the new two-column title box
        self.render_title_box()

        # Initialize backend after displaying UI
        self.initialize_backend()

        # Show streaming greeting
        username = get_username()
        greeting = f"Hey {username}! 👋 How can I help get things done today?"
        self.stream_text(greeting)
        self.conversation_history.append({"role": "assistant", "content": greeting})

        while True:
            try:
                # Add a newline before the prompt for better separation
                self.console.print()
                
                # Create custom style for prompt_toolkit input
                style = PromptStyle.from_dict({
                    '': PROMPT_COLOR,  # Input text color (e.g., #FFCCFF)
                })
                # Use prompt_toolkit for styled input
                user_input = prompt_toolkit_prompt(
                    HTMLText(f'<style fg="{PROMPT_COLOR}">>>> </style>'),
                    style=style
                ).strip()
            except (EOFError, KeyboardInterrupt):
                self.graceful_exit()
                break

            if not user_input:
                continue

            # Handle slash commands first
            slash_result = self.handle_slash_command(user_input)
            if slash_result == "exit":
                break
            if slash_result:
                continue

            # Store user message
            self.conversation_history.append({
                "role": "user",
                "content": user_input
            })

            # Get response from LM Studio
            response = self.get_response(user_input)

            # Store assistant response
            self.conversation_history.append({
                "role": "assistant",
                "content": response
            })

            # Parse tool requests
            tool_requests = self.parse_tool_requests(response)

            # Display cleaned response with gradient
            cleaned = self.clean_response(response)
            if cleaned:
                # Always print if streaming is disabled OR if it's an error/special message
                if not self.streaming_enabled or response.startswith("["):
                    print_yips(cleaned)

            # Execute tool requests autonomously
            for request in tool_requests:
                result = self.execute_tool(request)
                self.console.print(f"[dim]{result}[/dim]")
                self.conversation_history.append({
                    "role": "system",
                    "content": result
                })


# =============================================================================
# Entry Point
# =============================================================================

def main():
    agent = YipsAgent()
    agent.run()


if __name__ == "__main__":
    main()
