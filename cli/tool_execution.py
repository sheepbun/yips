"""
Tool parsing and execution for Yips CLI.

Handles parsing tool requests from responses and executing them autonomously.
"""

import re
import subprocess
from datetime import datetime
from pathlib import Path

from cli.color_utils import console, PROMPT_COLOR
from cli.config import BASE_DIR
from cli.type_defs import ToolRequest, ActionToolRequest, IdentityToolRequest

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


def parse_tool_requests(response: str) -> list[ToolRequest]:
    """Parse tool request tags from response text."""
    requests_list: list[ToolRequest] = []

    # Pattern: {ACTION:tool:params}
    action_pattern = r"\{ACTION:(\w+):([^}]*)\}"
    for match in re.finditer(action_pattern, response):
        action_request: ActionToolRequest = {
            "type": "action",
            "tool": match.group(1),
            "params": match.group(2)
        }
        requests_list.append(action_request)

    # Pattern: {UPDATE_IDENTITY:reflection}
    identity_pattern = r"\{UPDATE_IDENTITY:([^}]*)\}"
    for match in re.finditer(identity_pattern, response):
        identity_request: IdentityToolRequest = {
            "type": "identity",
            "reflection": match.group(1)
        }
        requests_list.append(identity_request)

    return requests_list


def is_destructive_command(command: str) -> bool:
    """Check if a command matches destructive patterns."""
    for pattern in DESTRUCTIVE_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return True
    return False


def confirm_action(description: str) -> bool:
    """Ask user for confirmation (only for destructive commands)."""
    console.print(f"\n[bold red]Warning: Destructive command detected![/bold red]")
    console.print(f"[yellow]{description}[/yellow]")
    console.print("Allow? ", style=PROMPT_COLOR, end="")
    response = input().strip().lower()
    return response in ("y", "yes")


def log_action(description: str) -> None:
    """Log an autonomous action being taken."""
    console.print(f"  [dim italic][{description}][/dim italic]")


def execute_tool(request: ToolRequest) -> str:
    """Execute a tool request (autonomously unless destructive)."""

    if request["type"] == "action":
        tool: str = str(request["tool"])
        params: str = str(request["params"])

        if tool == "read_file":
            path = params.strip()
            log_action(f"reading: {path}")
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
            log_action(f"writing: {path}")
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
            if is_destructive_command(command):
                if not confirm_action(f"Run: {command}"):
                    return "[Command cancelled by user]"

            log_action(f"running: {command}")
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
        log_action("updating identity")
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


def clean_response(response: str) -> str:
    """Remove tool request tags from response for display."""
    cleaned = response
    cleaned = re.sub(r"\{ACTION:\w+:[^}]*\}", "", cleaned)
    cleaned = re.sub(r"\{UPDATE_IDENTITY:[^}]*\}", "", cleaned)
    return cleaned.strip()
