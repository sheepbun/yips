"""
Tool parsing and execution for Yips CLI.

Handles parsing tool requests from responses and executing them autonomously.
"""

import os
import re
import subprocess
import sys
import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, cast, Any
from collections.abc import Callable

if TYPE_CHECKING:
    from cli.type_defs import YipsAgentProtocol
    from rich.console import RenderableType

import difflib
from cli.color_utils import console, PROMPT_COLOR
from cli.ui_rendering import render_text_preview
from cli.config import BASE_DIR, WORKING_ZONE, SKILLS_DIR, TOOLS_DIR, PLANS_DIR
from cli.root import PROJECT_ROOT
from cli.subprocess_utils import clean_subprocess_env
from cli.type_defs import ToolRequest

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
            data = json.loads(message_json)
            
            if isinstance(data, dict):
                data_dict = cast(dict[str, Any], data)
                
                # Map Claude tools to Yips tools
                if "search" in channel or "google" in channel or "query" in data_dict or "q" in data_dict:
                    # Map to SEARCH skill
                    query = data_dict.get("query", data_dict.get("q", ""))
                    requests_list.append({
                        "type": "skill",
                        "skill": "SEARCH",
                        "args": str(query)
                    })
                    continue

                if "run_command" in channel or "execute" in channel:
                    tool = "run_command"
                    params = data_dict.get("command", "")
                elif "write" in channel:
                    tool = "write_file"
                    params = f"{data_dict.get('path', '')}:{data_dict.get('content', '')}"
                elif "read" in channel:
                    tool = "read_file"
                    params = data_dict.get("path", "")
                elif "ls" in channel or "list" in channel:
                    tool = "ls"
                    params = data_dict.get("path", ".")
                elif "grep" in channel:
                    tool = "grep"
                    params = f"{data_dict.get('pattern', '')}:{data_dict.get('path', '.')}"
                elif "git" in channel:
                    tool = "git"
                    params = data_dict.get("subcommand", data_dict.get("command", ""))
                else:
                    # Fallback: try to guess or use as a generic command
                    if "command" in data_dict:
                        tool = "run_command"
                        params = data_dict["command"]
                    else:
                        # Skip if it's just some other dict we don't understand
                        continue
            else:
                # Fallback for non-dict data
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

    # Deduplicate identical consecutive requests (LLMs sometimes repeat tool tags)
    seen: set[str] = set()
    deduped: list[ToolRequest] = []
    for req in requests_list:
        # Build a hashable key from the request
        key = str(sorted(req.items()))
        if key not in seen:
            seen.add(key)
            deduped.append(req)
    return deduped


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


def confirm_action(
    description: str,
    is_destructive: bool = False,
    pause_live: Callable[[], None] | None = None,
    resume_live: Callable[[], None] | None = None,
    non_interactive: bool = False,
) -> bool:
    """Ask user for confirmation. In non-interactive mode, auto-deny."""
    if non_interactive:
        return False
    if pause_live:
        pause_live()
    try:
        if is_destructive:
            console.print(f"\n[bold red]Warning: Destructive command detected![/bold red]")
        else:
            console.print(f"\n[bold yellow]Notice: Action outside working zone[/bold yellow]")

        console.print(f"[yellow]{description}[/yellow]")
        console.print("Allow? (y/n): ", style=PROMPT_COLOR, end="")
        response = input().strip().lower()
        return response in ("y", "yes")
    finally:
        if resume_live:
            resume_live()


def emit_preview(
    renderable: "RenderableType",
    preview_callback: Callable[["RenderableType"], None] | None = None,
) -> None:
    """Display a preview renderable inline with the current UI when possible."""
    if preview_callback:
        preview_callback(renderable)
    else:
        console.print(renderable)


def execute_tool(
    request: ToolRequest,
    agent: "YipsAgentProtocol | None" = None,
    preview_callback: Callable[["RenderableType"], None] | None = None,
    pause_live: Callable[[], None] | None = None,
    resume_live: Callable[[], None] | None = None,
    non_interactive: bool = False,
    allowed_tools: set[str] | None = None,
) -> str:
    """Execute a tool request (autonomously unless destructive or out of bounds).

    Args:
        non_interactive: If True, skip all user confirmation prompts and auto-deny
            destructive / out-of-zone / preview-requiring actions.
        allowed_tools: Optional allow-list of tool/skill/request names; anything
            not in the set returns an error without executing.
    """

    # Allow-list enforcement (applies to actions, skills, identity alike)
    if allowed_tools is not None:
        req_type = request["type"]
        if req_type == "action":
            name_for_gate = str(request["tool"])
        elif req_type == "skill":
            name_for_gate = str(request["skill"])
        elif req_type == "identity":
            name_for_gate = "update_identity"
        else:
            name_for_gate = ""
        if name_for_gate and name_for_gate not in allowed_tools:
            return f"[Error: tool '{name_for_gate}' is not permitted in this context]"

    if request["type"] == "action":
        tool: str = str(request["tool"])
        params: str = str(request["params"])

        if tool == "read_file":
            path = params.strip()
            if not is_in_working_zone(path):
                if not confirm_action(f"Read file outside working zone: {path}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
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
                if not confirm_action(f"Write file outside working zone: {path}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[Write cancelled by user]"
            try:
                p = Path(path).expanduser()
                p.parent.mkdir(parents=True, exist_ok=True)
                if p.exists():
                    # Show diff preview for existing files
                    old_content = p.read_text()
                    diff_lines = list(difflib.unified_diff(
                        old_content.splitlines(), content.splitlines(),
                        fromfile=f"a/{path}", tofile=f"b/{path}", lineterm=""
                    ))
                    if diff_lines and not non_interactive:
                        diff_text = "\n".join(diff_lines)
                        if pause_live:
                            pause_live()
                        try:
                            console.print(render_text_preview(path, diff_text, mode="diff", title="📝 Write Preview"))
                            console.print("Apply this write? (y/n): ", style=PROMPT_COLOR, end="")
                            response = input().strip().lower()
                            if response not in ("y", "yes"):
                                return "[Write cancelled by user]"
                        finally:
                            if resume_live:
                                resume_live()
                elif not non_interactive:
                    # New file: show preview and ask for confirmation
                    if pause_live:
                        pause_live()
                    try:
                        console.print(render_text_preview(path, content, mode="preview", title="📝 New File"))
                        console.print("Create this new file? (y/n): ", style=PROMPT_COLOR, end="")
                        confirm = input().strip().lower()
                        if confirm not in ("y", "yes"):
                            return "[Write cancelled by user]"
                    finally:
                        if resume_live:
                            resume_live()
                p.write_text(content)
                return f"[File written: {path}]"
            except Exception as e:
                return f"[Error writing file: {e}]"

        elif tool == "run_command":
            command = params.strip()

            # Check for destructive commands
            if is_destructive_command(command):
                if not confirm_action(f"Run: {command}", is_destructive=True, pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[Command cancelled by user]"

            # Check for out-of-zone activity (heuristically)
            if not any(is_in_working_zone(p) for p in [".", os.getcwd()]):
                 if not confirm_action(f"Run command in non-working directory: {os.getcwd()}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[Command cancelled by user]"

            try:
                result = subprocess.run(
                    command,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    env=clean_subprocess_env(),
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
                if not confirm_action(f"List directory outside working zone: {path}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[ls cancelled by user]"
            try:
                if os.name == 'nt':
                    result = subprocess.run(f'dir "{path}"', shell=True, capture_output=True, text=True, timeout=10)
                else:
                    result = subprocess.run(f"ls -F1 {path}", shell=True, capture_output=True, text=True, timeout=10, env=clean_subprocess_env())
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
                if not confirm_action(f"Grep outside working zone: {path}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[grep cancelled by user]"
            try:
                if os.name == 'nt':
                    result = subprocess.run(f'findstr /s /n /i "{pattern}" "{path}"', shell=True, capture_output=True, text=True, timeout=30)
                else:
                    result = subprocess.run(f"grep -rnI \"{pattern}\" {path}", shell=True, capture_output=True, text=True, timeout=30, env=clean_subprocess_env())
                if result.stdout:
                    return f"[Grep matches for '{pattern}' in {path}]:\n{result.stdout}"
                return f"[No matches found for '{pattern}' in {path}]"
            except Exception as e:
                return f"[Error running grep: {e}]"

        elif tool == "git":
            subcommand = params.strip()
            try:
                # Run git command from project root
                result = subprocess.run(f"git {subcommand}", shell=True, capture_output=True, text=True, timeout=30, cwd=PROJECT_ROOT, env=clean_subprocess_env())
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
                if not confirm_action(f"Sed outside working zone: {path}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[sed cancelled by user]"
            try:
                if os.name == 'nt':
                    return "[Error: sed is not available on Windows. Use the edit_file tool instead.]"
                # and return output unless it's clearly an in-place edit request.
                # Actually, most agents want to modify files.
                # Let's support both. If expression contains -i, we handle it.
                result = subprocess.run(f"sed {expression} {path}", shell=True, capture_output=True, text=True, timeout=10, env=clean_subprocess_env())
                if result.returncode == 0:
                    return f"[Sed output for {path}]:\n{result.stdout}" if result.stdout else f"[Sed operation on {path} completed]"
                return f"[Error running sed on {path}]: {result.stderr}"
            except Exception as e:
                return f"[Error running sed: {e}]"

        elif tool == "edit_file":
            # Parse path:::old_string:::new_string (triple-colon separator)
            sep = ":::"
            parts = params.split(sep, 2)
            if len(parts) < 3:
                return "[Error: edit_file requires path:::old_string:::new_string]"
            path, old_string, new_string = parts[0].strip(), parts[1], parts[2]
            if not is_in_working_zone(path):
                if not confirm_action(f"Edit file outside working zone: {path}", pause_live=pause_live, resume_live=resume_live, non_interactive=non_interactive):
                    return "[Edit cancelled by user]"
            try:
                p = Path(path).expanduser()
                if not p.exists():
                    return f"[Error: File not found: {path}]"
                file_content = p.read_text()
                count = file_content.count(old_string)
                if count == 0:
                    return f"[Error: old_string not found in {path}]"
                if count > 1:
                    return f"[Error: old_string found {count} times in {path} — must be unique]"
                # Generate diff
                new_content = file_content.replace(old_string, new_string, 1)
                if not non_interactive:
                    diff_lines = list(difflib.unified_diff(
                        file_content.splitlines(), new_content.splitlines(),
                        fromfile=f"a/{path}", tofile=f"b/{path}", lineterm=""
                    ))
                    diff_text = "\n".join(diff_lines) if diff_lines else "(No textual changes detected)"
                    if pause_live:
                        pause_live()
                    try:
                        console.print(render_text_preview(path, diff_text, mode="diff", title="✏️ Edit Preview"))
                        console.print("Apply this change? (y/n): ", style=PROMPT_COLOR, end="")
                        response = input().strip().lower()
                        if response not in ("y", "yes"):
                            return "[Edit cancelled by user]"
                    finally:
                        if resume_live:
                            resume_live()
                p.write_text(new_content)
                return f"[File edited: {path}]"
            except Exception as e:
                return f"[Error editing file: {e}]"

        elif tool == "create_plan":
            # Parse name:content (first colon splits)
            parts = params.split(":", 1)
            if len(parts) < 2:
                return "[Error: create_plan requires name:content]"
            name, content = parts[0].strip(), parts[1]
            try:
                PLANS_DIR.mkdir(parents=True, exist_ok=True)
                plan_path = PLANS_DIR / f"{name}.md"
                emit_preview(
                    render_text_preview(str(plan_path), content, mode="preview", title="📋 Plan"),
                    preview_callback,
                )
                plan_path.write_text(content)
                return f"[Plan created: {plan_path}]"
            except Exception as e:
                return f"[Error creating plan: {e}]"

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

        # Guardrail: Prevent searching for the literal word "query"
        if skill_name == "SEARCH" and args.strip().lower() == "query":
            return "[Error: You searched for the literal placeholder 'query'. Please search for a specific topic (e.g. 'current LLM context limits', 'weather in Tokyo').]"

        # Search for skill in commands/skills/<NAME>/<NAME>.py OR commands/tools/<NAME>/<NAME>.py
        skill_path = SKILLS_DIR / skill_name / f"{skill_name}.py"
        if not skill_path.exists():
            skill_path = TOOLS_DIR / skill_name / f"{skill_name}.py"
            
        if not skill_path.exists():
            return f"[Error: Skill not found: {skill_name}]"

        try:
            # Prefer venv python for skill execution if available
            if sys.platform == 'win32':
                venv_python = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
            else:
                venv_python = PROJECT_ROOT / ".venv" / "bin" / "python3"
            executable = str(venv_python) if venv_python.exists() else sys.executable

            cmd = [executable, str(skill_path)] + (args.split() if args else [])
            env = {**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}
            
            # Special handling for interactive VT skill
            if skill_name.upper() == "VT":
                if pause_live:
                    pause_live()
                try:
                    subprocess.run(cmd, env=env) # Interactive, no capture, no timeout
                    return "[Virtual Terminal session ended]"
                finally:
                    if resume_live:
                        resume_live()

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

def _restore_utf8(text: str) -> str:
    """Fix text decoded as latin-1 by re-encoding it as utf-8."""
    if not text:
        return text
    try:
        restored = text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    return restored


def _strip_non_ascii(text: str) -> str:
    """Drop characters outside the ASCII printable range to avoid mojibake."""
    if not text:
        return text
    allowed = set("\n\r\t")
    return "".join(ch for ch in text if (ord(ch) >= 32 and ord(ch) < 127) or ch in allowed)


def _strip_internal_plan_blocks(text: str) -> str:
    """Remove redundant plan-style python blocks emitted early in the response."""
    pattern = re.compile(
        r"```python\s+(?:#.*\n)*def\s+main\(\):[\s\S]*?if\s+__name__\s*==\s*['\"]__main__['\"]\s*:\s*main\(\)\s*```",
        flags=re.MULTILINE,
    )

    def is_plain_print_plan(block: str) -> bool:
        lower_block = block.lower()
        if lower_block.count("print(") < 3:
            return False
        parts = block.split("def main():", 1)
        if len(parts) < 2:
            return False
        body = parts[1]
        statements = [
            line.strip()
            for line in body.splitlines()
            if line.strip() and not line.strip().startswith("if __name__")
        ]
        if not statements:
            return False
        has_non_print = any(
            not stmt.startswith("print(") and not stmt.startswith("print ")
            for stmt in statements
        )
        if has_non_print:
            return False
        keywords = ("import ", "from ", "class ", "def ", "for ", "while ", "with ", "return ", "if ")
        if any(keyword in stmt for stmt in statements for keyword in keywords):
            return False
        return True

    def replace(match: re.Match[str]) -> str:
        block = match.group(0)
        if match.start() <= 400 and is_plain_print_plan(block):
            return ""
        return block

    return pattern.sub(replace, text)


def clean_response(response: str) -> str:
    """Remove tool request tags from response for display, but keep those in code blocks."""
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
    
    def replace_fn(match: re.Match[str]) -> str:
        text = match.group(0)
        # If it's a code block (starts with backtick), keep it
        if text.startswith('`'):
            return text
        # Otherwise, it's a tag or internal metadata, remove it
        return ""
        
    cleaned = re.sub(pattern, replace_fn, response, flags=re.DOTALL)

    # Strip incomplete trailing tags missing their closing '}' (truncated output or feedback loop)
    cleaned = re.sub(r"\{(?:ACTION|INVOKE_SKILL|UPDATE_IDENTITY|THOUGHT):[^}]*$", "", cleaned, flags=re.DOTALL)

    # Strip session-memory dumps or leaked persisted transcript content if the model
    # echoes them back into the visible response.
    session_markers = [
        r"(?ms)^# Session Memory.*?(?=\n{2,}|\Z)",
        r"(?ms)^## Conversation.*?(?=\n{2,}|\Z)",
        r"(?m)^\*\[System:.*$",
        r"(?m)^\*Last updated:.*$",
        r"(?m)^### Active Conversation.*$",
        r"(?m)^### Archived Conversation.*$",
        r"(?m)^### Running Summary.*$",
        r"(?m)^\*\*Created\*\*:.*$",
        r"(?m)^\*\*Type\*\*:.*$",
    ]
    for marker in session_markers:
        cleaned = re.sub(marker, "", cleaned)

    # If a persisted transcript leaks into the model output, drop everything from
    # the first session-memory marker onward rather than trying to display it.
    session_cut_markers = [
        "\n## 20",
        "\n# Session Memory",
        "\n## Conversation",
        "\n### Active Conversation",
        "\n### Archived Conversation",
        "\n### Running Summary",
        "\n**Katherine**:",
        "\n**Yips**:",
    ]
    cut_positions = [cleaned.find(marker) for marker in session_cut_markers if cleaned.find(marker) != -1]
    if cut_positions:
        cleaned = cleaned[:min(cut_positions)]

    # Final pass: if the entire remaining content is just a JSON blob, hide it
    # (This handles cases where the model only outputs tool parameters)
    stripped = cleaned.strip()
    if stripped.startswith('{') and stripped.endswith('}'):
        try:
            json.loads(stripped)
            return ""
        except:
            pass
            
    # Also handle <think> blocks - hide them from display
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"<think>.*$", "", cleaned, flags=re.DOTALL) # Handle open thinking blocks

    # Remove repeated blank lines left after stripping internal content.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    # Repair responses that were decoded with latin-1 instead of utf-8.
    cleaned = _restore_utf8(cleaned)
    cleaned = _strip_non_ascii(cleaned)
    cleaned = _strip_internal_plan_blocks(cleaned)

    code_only_in_action = "{ACTION:write_file:" in response and "```" in cleaned
    if code_only_in_action:
        code_removed = re.sub(r"```[\s\S]*?```", "", cleaned)
        if code_removed.strip():
            cleaned = code_removed
        else:
            # There was no other text, so show a fallback message referencing the file path.
            match = re.search(r"\{ACTION:write_file:([^:}]+):", response)
            path = match.group(1) if match else "the target file"
            cleaned = f"[Script moved to {path}; code blocks suppressed in the terminal.]"

    return cleaned.strip()
