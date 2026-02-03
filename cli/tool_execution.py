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

from cli.color_utils import console, PROMPT_COLOR, print_gradient, blue_gradient_text
from cli.config import BASE_DIR, SKILLS_DIR, WORKING_ZONE
from cli.root import PROJECT_ROOT
from cli.type_defs import ToolRequest, ActionToolRequest, IdentityToolRequest, SkillToolRequest, ThoughtToolRequest

# Destructive commands that require confirmation
DESTRUCTIVE_PATTERNS = [
    r"rm\s+(-[rf]+\s+)*(/|~|\$HOME)",
    r"rm\s+-rf\s+",
    r"mkfs",
    r"dd\s+if=",
    r">\s*/dev/",
    r"chmod\s+-R\s+777\s+/",
    r":(){ :|:& };:",
    r"pacman\s+-[RS]", # Arch Linux destructive commands
    r"apt\s+remove",
    r"apt\s+purge",
    r"dnf\s+remove",
    r"systemctl\s+stop",
    r"reboot",
    r"shutdown",
    r"ls\s+-R\s+/",
]


def parse_tool_requests(response: str) -> list[ToolRequest]:
    """Parse tool request tags from response text, excluding those in large code blocks."""
    # Mask out triple backtick blocks to avoid parsing example tags
    masked_response = response
    
    # Mask triple backtick blocks
    masked_response = re.sub(r"```.*?```", lambda m: " " * len(m.group(0)), masked_response, flags=re.DOTALL)
    
    requests_list: list[ToolRequest] = []

    # 1. Pattern: {ACTION:tool:params}
    action_pattern = r"\{ACTION:\s*(\w+)\s*:\s*([^}]*)\}"
    for match in re.finditer(action_pattern, masked_response):
        start, end = match.span()
        original_match = response[start:end]
        m = re.match(action_pattern, original_match)
        if m:
            requests_list.append({
                "type": "action",
                "tool": m.group(1),
                "params": m.group(2)
            })

    # 2. Pattern: Claude Code internal tool format
    # Example: <|channel|>commentary to=repo_browser.run_command\n<|constrain|>json<|message|>{"command":"mkdir -p temp"}
    claude_tool_pattern = r"<\|channel\|>.*?to=([a-zA-Z0-9_\.]+)[\s\S]*?<\|message\|>(\{.*?\})"
    for match in re.finditer(claude_tool_pattern, masked_response):
        channel = match.group(1) # e.g. "repo_browser.run_command" or "search"
        message_json = match.group(2) # e.g. '{"command":"mkdir -p temp"}'
        
        try:
            import json
            data = json.loads(message_json)
            
            # Map Claude tools to Yips tools
            if "search" in channel or "google" in channel or (isinstance(data, dict) and ("query" in data or "q" in data)):
                # Map to SEARCH skill
                query = data.get("query", data.get("q", ""))
                requests_list.append({
                    "type": "skill",
                    "skill": "SEARCH",
                    "args": str(query)
                })
                continue

            if "run_command" in channel or "execute" in channel:
                tool = "run_command"
                params = data.get("command", "")
            elif "write" in channel:
                tool = "write_file"
                params = f"{data.get('path', '')}:{data.get('content', '')}"
            elif "read" in channel:
                tool = "read_file"
                params = data.get("path", "")
            elif "ls" in channel or "list" in channel:
                tool = "ls"
                params = data.get("path", ".")
            elif "grep" in channel:
                tool = "grep"
                params = f"{data.get('pattern', '')}:{data.get('path', '.')}"
            elif "git" in channel:
                tool = "git"
                params = data.get("subcommand", data.get("command", ""))
            else:
                # Fallback: try to guess or use as a generic command
                # ONLY if it looks like a command string or has a command key
                if isinstance(data, dict):
                    if "command" in data:
                        tool = "run_command"
                        params = data["command"]
                    else:
                        # Skip if it's just some other dict we don't understand
                        continue
                else:
                    tool = "run_command"
                    params = str(data)

            requests_list.append({
                "type": "action",
                "tool": tool,
                "params": params
            })
        except Exception:
            continue

    # 3. Pattern: {UPDATE_IDENTITY:reflection}
    identity_pattern = r"\{UPDATE_IDENTITY:([^}]*)\}"
    for match in re.finditer(identity_pattern, masked_response):
        start, end = match.span()
        original_match = response[start:end]
        m = re.match(identity_pattern, original_match)
        if m:
            requests_list.append({
                "type": "identity",
                "reflection": m.group(1)
            })

    # 4. Pattern: {INVOKE_SKILL:skill:args}
    skill_pattern = r"\{INVOKE_SKILL:\s*(\w+)\s*(?::\s*([^}]*))?\}"
    for match in re.finditer(skill_pattern, masked_response):
        start, end = match.span()
        original_match = response[start:end]
        m = re.match(skill_pattern, original_match)
        if m:
            requests_list.append({
                "type": "skill",
                "skill": m.group(1),
                "args": m.group(2) if m.group(2) is not None else ""
            })

    # 5. Pattern: {THOUGHT:signature}
    thought_pattern = r"\{THOUGHT:([^}]*)\}"
    for match in re.finditer(thought_pattern, masked_response):
        start, end = match.span()
        original_match = response[start:end]
        m = re.match(thought_pattern, original_match)
        if m:
            requests_list.append({
                "type": "thought",
                "signature": m.group(1)
            })

    return requests_list


def is_destructive_command(command: str) -> bool:
    """Check if a command matches destructive patterns."""
    for pattern in DESTRUCTIVE_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return True
    return False


def is_in_working_zone(path: str | Path) -> bool:
    """Check if a path is within the designated WORKING_ZONE."""
    try:
        target_path = Path(path).expanduser().resolve()
        zone_path = WORKING_ZONE.resolve()
        return zone_path in target_path.parents or target_path == zone_path
    except Exception:
        return False


def confirm_action(description: str, is_destructive: bool = False) -> bool:
    """Ask user for confirmation."""
    if is_destructive:
        console.print(f"\n[bold red]Warning: Destructive command detected![/bold red]")
    else:
        console.print(f"\n[bold yellow]Notice: Action outside working zone[/bold yellow]")
        
    console.print(f"[yellow]{description}[/yellow]")
    console.print("Allow? (y/n): ", style=PROMPT_COLOR, end="")
    response = input().strip().lower()
    return response in ("y", "yes")


def execute_tool(request: ToolRequest, agent: Any = None) -> str:
    """Execute a tool request (autonomously unless destructive or out of bounds)."""

    if request["type"] == "action":
        tool: str = str(request["tool"])
        params: str = str(request["params"])

        if tool == "read_file":
            path = params.strip()
            if not is_in_working_zone(path):
                if not confirm_action(f"Read file outside working zone: {path}"):
                    return "[Read cancelled by user]"
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
            if not is_in_working_zone(path):
                if not confirm_action(f"Write file outside working zone: {path}"):
                    return "[Write cancelled by user]"
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
                if not confirm_action(f"Run: {command}", is_destructive=True):
                    return "[Command cancelled by user]"
            
            # Check for out-of-zone activity (heuristically)
            if not any(is_in_working_zone(p) for p in [".", os.getcwd()]):
                 if not confirm_action(f"Run command in non-working directory: {os.getcwd()}"):
                    return "[Command cancelled by user]"

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

        elif tool == "ls":
            path = params.strip() or "."
            if not is_in_working_zone(path):
                if not confirm_action(f"List directory outside working zone: {path}"):
                    return "[ls cancelled by user]"
            try:
                # Use -F for file type indicators and -1 for one-per-line
                result = subprocess.run(f"ls -F1 {path}", shell=True, capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    return f"[Directory listing for {path}]:\n{result.stdout}"
                return f"[Error listing {path}]: {result.stderr}"
            except Exception as e:
                return f"[Error running ls: {e}]"

        elif tool == "grep":
            # Expecting "pattern:path" or just "pattern"
            parts = params.split(":", 1)
            pattern = parts[0].strip()
            path = parts[1].strip() if len(parts) > 1 else "."
            if not is_in_working_zone(path):
                if not confirm_action(f"Grep outside working zone: {path}"):
                    return "[grep cancelled by user]"
            try:
                # Use -r for recursive, -n for line numbers, -I to ignore binary files
                result = subprocess.run(f"grep -rnI \"{pattern}\" {path}", shell=True, capture_output=True, text=True, timeout=30)
                if result.stdout:
                    return f"[Grep matches for '{pattern}' in {path}]:\n{result.stdout}"
                return f"[No matches found for '{pattern}' in {path}]"
            except Exception as e:
                return f"[Error running grep: {e}]"

        elif tool == "git":
            subcommand = params.strip()
            try:
                # Run git command from project root
                result = subprocess.run(f"git {subcommand}", shell=True, capture_output=True, text=True, timeout=30, cwd=PROJECT_ROOT)
                output = result.stdout
                if result.stderr:
                    output += f"\n[git stderr]: {result.stderr}"
                return f"[Git output (git {subcommand})]:\n{output}" if output else f"[Git {subcommand} completed]"
            except Exception as e:
                return f"[Error running git: {e}]"

        elif tool == "sed":
            # Expecting "expression:path"
            parts = params.split(":", 1)
            if len(parts) < 2:
                return "[Error: sed requires expression:path]"
            expression, path = parts[0].strip(), parts[1].strip()
            if not is_in_working_zone(path):
                if not confirm_action(f"Sed outside working zone: {path}"):
                    return "[sed cancelled by user]"
            try:
                # and return output unless it's clearly an in-place edit request.
                # Actually, most agents want to modify files.
                # Let's support both. If expression contains -i, we handle it.
                result = subprocess.run(f"sed {expression} {path}", shell=True, capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    return f"[Sed output for {path}]:\n{result.stdout}" if result.stdout else f"[Sed operation on {path} completed]"
                return f"[Error running sed on {path}]: {result.stderr}"
            except Exception as e:
                return f"[Error running sed: {e}]"

        else:
            return f"[Unknown tool: {tool}]"

    elif request["type"] == "identity":
        reflection: str = str(request["reflection"])
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
        skill_name: str = str(request["skill"]).upper()
        args: str = str(request["args"])

        # Search for skill in commands/skills/<NAME>/<NAME>.py OR commands/tools/<NAME>/<NAME>.py
        from cli.config import SKILLS_DIR, TOOLS_DIR
        skill_path = SKILLS_DIR / skill_name / f"{skill_name}.py"
        if not skill_path.exists():
            skill_path = TOOLS_DIR / skill_name / f"{skill_name}.py"
            
        if not skill_path.exists():
            return f"[Error: Skill not found: {skill_name}]"

        try:
            # Prefer venv python for skill execution if available
            venv_python = PROJECT_ROOT / ".venv" / "bin" / "python3"
            executable = str(venv_python) if venv_python.exists() else sys.executable

            cmd = [executable, str(skill_path)] + (args.split() if args else [])
            env = {**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}
            
            # Special handling for interactive VT skill
            if skill_name.upper() == "VT":
                subprocess.run(cmd, env=env) # Interactive, no capture, no timeout
                return "[Virtual Terminal session ended]"

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
                elif cmd_name == "REPROMPT":
                    # Return special signal with the reprompt message
                    return f"::YIPS_REPROMPT::{cmd_args}"

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
    import json
    
    tags_to_remove = [
        r"\{ACTION:\s*\w+\s*:[^}]*\}",
        r"\{UPDATE_IDENTITY:[^}]*\}",
        r"\{INVOKE_SKILL:\s*\w+\s*(?::[^}]*)?\}",
        r"\{THOUGHT:[^}]*\}",
        r"<\|channel\|>.*?to=[a-zA-Z0-9_\.]*",
        r"<\|constrain\|>[a-z0-9]*",
        r"<\|message\|>",
        r"<\|.*?\|>"
    ]
    
    # Match code blocks first to protect them, then tags to remove
    pattern = r"(```.*?```|`[^`]*`|" + "|".join(tags_to_remove) + ")"
    
    def replace_fn(match):
        text = match.group(0)
        # If it's a code block (starts with backtick), keep it
        if text.startswith('`'):
            return text
        # Otherwise, it's a tag or internal metadata, remove it
        return ""
        
    cleaned = re.sub(pattern, replace_fn, response, flags=re.DOTALL)
    
    # Final pass: if the entire remaining content is just a JSON blob, hide it
    # (This handles cases where the model only outputs tool parameters)
    stripped = cleaned.strip()
    if stripped.startswith('{') and stripped.endswith('}'):
        try:
            import json
            json.loads(stripped)
            return ""
        except:
            pass
            
    # Also handle <think> blocks - hide them from display
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"<think>.*$", "", cleaned, flags=re.DOTALL) # Handle open thinking blocks
            
    return cleaned.strip()
