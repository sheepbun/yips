"""
Tool parsing and execution for Yips CLI.

Handles parsing tool requests from responses and executing them autonomously.
"""

import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from cli.color_utils import console, PROMPT_COLOR, print_gradient
from cli.config import BASE_DIR, SKILLS_DIR
from cli.root import PROJECT_ROOT
from cli.type_defs import ToolRequest, ActionToolRequest, IdentityToolRequest, SkillToolRequest

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
    """Parse tool request tags from response text, excluding those in code blocks."""
    # Mask out code blocks to avoid parsing example tags
    masked_response = response
    
    # Mask triple backtick blocks
    masked_response = re.sub(r"```.*?```", lambda m: " " * len(m.group(0)), masked_response, flags=re.DOTALL)
    
    # Mask single backtick inline code
    masked_response = re.sub(r"`.*?`", lambda m: " " * len(m.group(0)), masked_response)

    requests_list: list[ToolRequest] = []

    # Pattern: {ACTION:tool:params}
    action_pattern = r"\{ACTION:(\w+):([^}]*)\}"
    for match in re.finditer(action_pattern, masked_response):
        # Extract parameters from the ORIGINAL response to preserve content
        # But wait, using masked_response indices is safer
        start, end = match.span()
        original_match = response[start:end]
        
        # We need to re-parse from the original match to get groups correctly
        # because the regex above might have matched simplified whitespace
        m = re.match(action_pattern, original_match)
        if m:
            action_request: ActionToolRequest = {
                "type": "action",
                "tool": m.group(1),
                "params": m.group(2)
            }
            requests_list.append(action_request)

    # Pattern: {UPDATE_IDENTITY:reflection}
    identity_pattern = r"\{UPDATE_IDENTITY:([^}]*)\}"
    for match in re.finditer(identity_pattern, masked_response):
        start, end = match.span()
        original_match = response[start:end]
        m = re.match(identity_pattern, original_match)
        if m:
            identity_request: IdentityToolRequest = {
                "type": "identity",
                "reflection": m.group(1)
            }
            requests_list.append(identity_request)

    # Pattern: {INVOKE_SKILL:skill:args} or {INVOKE_SKILL:skill}
    skill_pattern = r"\{INVOKE_SKILL:(\w+)(?::([^}]*))?\}"
    for match in re.finditer(skill_pattern, masked_response):
        start, end = match.span()
        original_match = response[start:end]
        m = re.match(skill_pattern, original_match)
        if m:
            skill_request: SkillToolRequest = {
                "type": "skill",
                "skill": m.group(1),
                "args": m.group(2) if m.group(2) is not None else ""
            }
            requests_list.append(skill_request)

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


def execute_tool(request: ToolRequest, agent: Any = None) -> str:
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

    elif request["type"] == "skill":
        skill_name: str = str(request["skill"])
        args: str = str(request["args"])
        log_action(f"invoking skill: {skill_name}")

        skill_path = SKILLS_DIR / f"{skill_name.upper()}.py"
        if not skill_path.exists():
            return f"[Error: Skill not found: {skill_name}]"

        try:
            cmd = [sys.executable, str(skill_path)] + (args.split() if args else [])
            env = {**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
            
            output = result.stdout
            
            # Check for control commands in output
            # Pattern: ::YIPS_COMMAND::COMMAND::ARGS
            command_pattern = r'::YIPS_COMMAND::(\w+)::(.*)'
            for match in re.finditer(command_pattern, output):
                cmd_name = match.group(1).upper()
                cmd_args = match.group(2).strip()
                
                if cmd_name == "RENAME":
                    if agent and hasattr(agent, 'rename_session'):
                        agent.rename_session(cmd_args)
                elif cmd_name == "EXIT":
                    if agent and hasattr(agent, 'graceful_exit'):
                        agent.graceful_exit()
                    return "::YIPS_EXIT::"
                
                # Filter out the command line
                output = output.replace(match.group(0), "")
            
            output = output.strip()

            final_output = output
            if result.stderr.strip():
                final_output += f"\n[stderr]: {result.stderr.strip()}"
                
            return f"[Skill output]:\n{final_output}" if final_output else "[Skill completed (no output)]"
        except subprocess.TimeoutExpired:
            return f"[Error: Skill /{skill_name} timed out]"
        except Exception as e:
            return f"[Error running skill /{skill_name}: {e}]"

    return "[Unknown request type]"


def clean_response(response: str) -> str:
    """Remove tool request tags from response for display, but keep those in code blocks."""
    # Find all tags
    action_pattern = r"\{ACTION:\w+:[^}]*\}"
    identity_pattern = r"\{UPDATE_IDENTITY:[^}]*\}"
    skill_pattern = r"\{INVOKE_SKILL:\w+(?::[^}]*)?\}"
    
    combined_pattern = f"({action_pattern})|({identity_pattern})|({skill_pattern})"
    
    # We want to remove tags that are NOT inside backticks
    # A simple way is to use a regex that matches backtick blocks OR the tags
    # and only replace the tags if they were matched outside backticks.
    
    # Pattern to match code blocks or tags
    pattern = r"(```.*?```|`.*?`|\{ACTION:\w+:[^}]*\}|\{UPDATE_IDENTITY:[^}]*\}|\{INVOKE_SKILL:\w+(?::[^}]*)?\})"
    
    def replace_fn(match):
        text = match.group(0)
        if text.startswith('`') or text.startswith('```'):
            return text  # Keep code blocks as is
        return ""  # Remove tags
        
    cleaned = re.sub(pattern, replace_fn, response, flags=re.DOTALL)
    return cleaned.strip()
