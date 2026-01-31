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

# Version - Automatically managed by git pre-commit hook
# Format: vYYYY.MM.DD-SHORTHASH (e.g., v2026.01.31-a3f52b9)
APP_NAME = "Yips"
APP_VERSION = "v2026.01.31-a8b02a2"

# Priority 0: LM Studio (local, free)
LM_STUDIO_URL = os.environ.get("LM_STUDIO_URL", "http://localhost:1234")
LM_STUDIO_MODELS_DIR = Path.home() / ".lmstudio" / "models"
LM_STUDIO_MODEL = os.environ.get("LM_STUDIO_MODEL", "lmstudio-community/gpt-oss-20b-GGUF")
LMS_CLI_PATH = os.environ.get("LMS_CLI_PATH", "/home/katherine/.lmstudio/bin/lms")
LM_STUDIO_AUTH = os.environ.get("LM_STUDIO_AUTH", "lmstudio")

# Priority 1: Claude CLI (fallback)
CLAUDE_CLI_PATH = os.environ.get("CLAUDE_CLI_PATH", "/home/katherine/.local/bin/claude")
CLAUDE_CLI_MODEL = os.environ.get("CLAUDE_CLI_MODEL", "sonnet")

# Gradient colors: Deep strawberry pink -> Banana yellow -> Light blue raspberry
GRADIENT_PINK = (255, 20, 147)      # #FF1493
GRADIENT_YELLOW = (255, 225, 53)    # #FFE135
GRADIENT_BLUE = (137, 207, 240)     # #89CFF0

# User prompt color
PROMPT_COLOR = "#FFCCFF"

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
    """Start LM Studio if not running and wait for it to be ready."""
    if is_lmstudio_running():
        return True

    # Start server headlessly via lms CLI
    subprocess.Popen(
        [LMS_CLI_PATH, "server", "start"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True
    )

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
    """Create gradient-colored text: pink -> yellow -> blue."""
    styled = Text()
    length = len(text)

    if length == 0:
        return styled

    for i, char in enumerate(text):
        progress = i / max(length - 1, 1)

        # Two-segment gradient
        if progress < 0.5:
            t = progress * 2
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, t)
        else:
            t = (progress - 0.5) * 2
            r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, t)

        styled.append(char, style=f"rgb({r},{g},{b})")

    return styled


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
    console.print()
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

        # Load saved configuration
        config = load_config()
        saved_model = config.get("model")
        saved_backend = config.get("backend")

        # Determine backend and model from saved config or defaults
        if saved_backend == "claude" and saved_model:
            self.use_claude_cli = True
            self.current_model = saved_model
        elif saved_backend == "lmstudio" and saved_model:
            self.use_claude_cli = False
            self.current_model = saved_model
            # Ensure LM Studio is running for saved LM Studio model
            if not is_lmstudio_running():
                self.console.print("[dim]Starting LM Studio...[/dim]")
                if not ensure_lmstudio_running():
                    self.console.print("[yellow]LM Studio unavailable, using Claude CLI.[/yellow]")
                    self.use_claude_cli = True
                    self.current_model = CLAUDE_CLI_MODEL
        else:
            # No saved config - use defaults
            self.use_claude_cli = False
            self.current_model = LM_STUDIO_MODEL
            if not is_lmstudio_running():
                self.console.print("[dim]Starting LM Studio...[/dim]")
                if ensure_lmstudio_running():
                    self.console.print("[dim]LM Studio ready.[/dim]")
                else:
                    self.console.print("[yellow]LM Studio unavailable, using Claude CLI.[/yellow]")
                    self.use_claude_cli = True
                    self.current_model = CLAUDE_CLI_MODEL

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
        messages.append({"role": "user", "content": message})

        headers = {
            "Content-Type": "application/json",
            "x-api-key": LM_STUDIO_AUTH,
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
                },
                timeout=120
            )
            response.raise_for_status()
            data = response.json()
            # Anthropic format: {"content": [{"type": "text", "text": "..."}]}
            return data["content"][0]["text"]

        except requests.exceptions.ConnectionError:
            return "[Error: Could not connect to LM Studio. Is it running?]"
        except requests.exceptions.Timeout:
            return "[Error: Request timed out after 120 seconds]"
        except Exception as e:
            return f"[Error calling LM Studio: {e}]"

    def call_claude_cli(self, message: str) -> str:
        """Fallback: Call Claude Code CLI (Priority 1)."""
        system_prompt = self.load_context()
        full_prompt = f"{system_prompt}\n\n---\n\nUser: {message}"

        try:
            result = subprocess.run(
                [CLAUDE_CLI_PATH, "-p", "--model", self.current_model],
                input=full_prompt,
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode == 0:
                return result.stdout.strip()
            return f"[Error from Claude CLI: {result.stderr}]"
        except subprocess.TimeoutExpired:
            return "[Error: Claude CLI timed out after 120 seconds]"
        except Exception as e:
            return f"[Error calling Claude CLI: {e}]"

    def get_response(self, message: str) -> str:
        """Get response using available backend (LM Studio or Claude CLI)."""
        if self.use_claude_cli:
            return self.call_claude_cli(message)

        response = self.call_lm_studio(message)
        # If LM Studio fails mid-session, fall back to CLI
        if response.startswith("[Error: Could not connect"):
            self.console.print("[yellow]LM Studio disconnected, switching to Claude CLI.[/yellow]")
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
                table.add_row(model, "Claude CLI", status)

            # LM Studio models
            for model in lm_models:
                is_current = not self.use_claude_cli and self.current_model == model
                status = "← current" if is_current else ""
                table.add_row(model, "LM Studio", status)

            self.console.print(table)
            return

        # Switch model
        model_name = args.lower()

        if model_name in claude_models:
            self.use_claude_cli = True
            self.current_model = model_name
            save_config({"backend": "claude", "model": model_name})
            self.console.print(f"[green]Switched to Claude CLI with model: {model_name}[/green]")
        elif args in lm_models or any(args.lower() in m.lower() for m in lm_models):
            # Find matching LM Studio model
            matched = args if args in lm_models else next(
                (m for m in lm_models if args.lower() in m.lower()), None
            )
            if matched:
                self.use_claude_cli = False
                self.current_model = matched
                save_config({"backend": "lmstudio", "model": matched})
                self.console.print(f"[green]Switched to LM Studio with model: {matched}[/green]")
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
        available.extend(["exit", "model"])
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
        backend = "Claude CLI" if self.use_claude_cli else "LM Studio"
        model = self.current_model
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
        left_col.append(f"{model} · Backend: {backend}")  # [9]
        left_col.append(cwd)  # [10]
        left_col.append("")  # [11] blank padding

        # Build right column
        right_col = [
            "Tips for getting started",  # [0]
            "Type /model to switch models",  # [1]
            "Type /exit to leave",  # [2]
            "─" * right_width,  # [3] divider
            "Recent activity",  # [4]
        ]
        # Add activity lines (up to 3)
        right_col.extend(activity)
        # Pad right column to match left column length
        while len(right_col) < len(left_col):
            right_col.append("")

        # Render top border with gradient
        title_text = "Yips CLI"
        version_text = f"v{APP_VERSION}"
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
            elif line_num == 1:  # Welcome message - pink to yellow gradient
                for i, char in enumerate(left_text):
                    char_progress = i / max(len(left_text) - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, char_progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
                # Pad to width with spaces
                styled_line.append(" " * (left_width - len(left_text)))
            elif line_num == 9:  # Model info - solid blue
                r, g, b = GRADIENT_BLUE
                blue_style = f"rgb({r},{g},{b})"
                styled_line.append(left_text, style=blue_style)
                # Pad to width with spaces
                styled_line.append(" " * (left_width - len(left_text)))
            else:
                # Other left content - center aligned with default color
                centered_text = left_text.center(left_width)
                styled_line.append(centered_text)

            # Divider bar
            styled_line.append("│", style=divider_style)

            # Right content with styling
            if line_num == 0:  # Tips header
                styled_line.append(right_text.ljust(right_width), style="bright_white")
            elif line_num == 3:  # Divider line with flowing gradient
                # Calculate starting position for right column content
                # Position: left border (1) + left content (left_width) + middle divider (1) = left_width + 2
                right_col_start_position = left_width + 2

                # Apply gradient to each character of the divider line
                padded_text = right_text.ljust(right_width)
                for i, char in enumerate(padded_text):
                    # Absolute position of this character in the terminal
                    char_position = right_col_start_position + i
                    # Calculate progress based on absolute position
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 4:  # Recent activity header
                styled_line.append(right_text.ljust(right_width), style="bright_white")
            elif line_num >= 5:  # Activity items
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

    def run(self):
        """Main conversation loop."""
        # Render the new two-column title box
        self.render_title_box()

        while True:
            try:
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
                self.console.print()
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
                print_yips(cleaned)

            # Execute tool requests autonomously
            for request in tool_requests:
                result = self.execute_tool(request)
                self.console.print(f"[dim]{result}[/dim]")
                self.conversation_history.append({
                    "role": "system",
                    "content": result
                })

            self.console.print()


# =============================================================================
# Entry Point
# =============================================================================

def main():
    agent = YipsAgent()
    agent.run()


if __name__ == "__main__":
    main()
