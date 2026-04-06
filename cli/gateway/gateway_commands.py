"""
Gateway slash command handler for Yips Discord Bot.

Intercepts /command messages in Discord and routes them to built-in handlers or
dynamic tool/skill executables, returning the result as a reply string.

Return value contract for handle_gateway_slash_command():
  None                        → not a slash command; caller falls through to AI
  "::GATEWAY_RESET::"         → caller should reset the channel session
  "::GATEWAY_REPROMPT::<msg>" → caller should route <msg> through the AI runner
  Any other str               → send this text back to Discord as a reply
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from cli.config import SKILLS_DIR, TOOLS_DIR
from cli.gateway.config import (
    GATEWAY_AGENTS,
    get_gateway_agent,
    set_gateway_agent,
)
from cli.gateway.discord_session import DiscordSessionManager
from cli.root import PROJECT_ROOT

# Sentinel strings used as structured return values
GATEWAY_RESET = "::GATEWAY_RESET::"
GATEWAY_REPROMPT_PREFIX = "::GATEWAY_REPROMPT::"

# Control-line pattern emitted by tool/skill scripts
_YIPS_COMMAND_PATTERN = re.compile(r"::YIPS_COMMAND::(\w+)::(.*)")

# Built-in commands that cannot function in Discord
_UI_ONLY = frozenset({"download", "dl", "gateway", "gw"})
_DISPLAY_ONLY = frozenset({"verbose", "stream"})
_CLI_ONLY = frozenset({"nick"})
_EXIT_COMMANDS = frozenset({"exit", "quit"})
_RESET_COMMANDS = frozenset({"clear", "new"})

# Human-readable list of built-in commands surfaced in /help
_BUILTIN_NAMES = [
    "clear", "new", "model", "models", "backend", "sessions",
    "help", "exit", "quit", "verbose", "stream", "download", "dl",
    "gateway", "gw", "nick",
]


def _list_available_commands() -> list[str]:
    """Return sorted list of all available command names."""
    names: list[str] = list(_BUILTIN_NAMES)
    for parent in (TOOLS_DIR, SKILLS_DIR):
        if parent.exists():
            names.extend(d.name.lower() for d in parent.iterdir() if d.is_dir())
    return sorted(set(names))


def _available_commands_text() -> str:
    return "Available: /" + ", /".join(_list_available_commands())


def _run_tool(tool_path: Path, args: str, channel_id: str, session_mgr: DiscordSessionManager) -> str:
    """Execute a tool .py file as a subprocess and return cleaned output."""
    venv_python = PROJECT_ROOT / ".venv" / "bin" / "python3"
    executable = str(venv_python) if venv_python.exists() else sys.executable

    cmd = [executable, str(tool_path)] + (args.split() if args else [])
    env = {**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
    except subprocess.TimeoutExpired:
        return f"⏱ Tool `/{tool_path.stem}` timed out."
    except Exception as exc:
        return f"❌ Error running `/{tool_path.stem}`: {exc}"

    output = result.stdout

    # Process ::YIPS_COMMAND:: control lines
    for match in _YIPS_COMMAND_PATTERN.finditer(output):
        cmd_name = match.group(1).upper()
        cmd_args = match.group(2).strip()

        if cmd_name == "RENAME":
            if hasattr(session_mgr, "rename_session"):
                session_mgr.rename_session(channel_id, cmd_args)  # type: ignore[attr-defined]
        elif cmd_name == "EXIT":
            output = output.replace(match.group(0), "")
            return "❌ `/exit` is not available in Discord."
        elif cmd_name == "REPROMPT":
            return f"{GATEWAY_REPROMPT_PREFIX}{cmd_args}"

        # Strip the control line from output
        output = output.replace(match.group(0), "")

    output = output.strip()

    if result.stderr.strip():
        stderr_note = f"\n⚠️ stderr: {result.stderr.strip()}"
        output = (output + stderr_note) if output else stderr_note.strip()

    return output


def handle_gateway_slash_command(
    content: str,
    channel_id: str,
    session_mgr: DiscordSessionManager,
) -> str | None:
    """
    Handle a Discord message that starts with '/'.

    Returns:
      None                           → not a slash command
      GATEWAY_RESET                  → caller resets the session
      "::GATEWAY_REPROMPT::<msg>"    → caller routes <msg> through the AI runner
      str                            → send as Discord reply
    """
    stripped = content.strip()
    if not stripped.startswith("/"):
        return None

    # Parse command name and optional args
    parts = stripped[1:].split(maxsplit=1)
    if not parts:
        return None

    command = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    # ── Exit / quit ────────────────────────────────────────────────────────────
    if command in _EXIT_COMMANDS:
        return "❌ Not available in Discord."

    # ── UI-only commands ───────────────────────────────────────────────────────
    if command in _UI_ONLY:
        return "❌ Opens a UI — not available in Discord."

    # ── Display-only settings ──────────────────────────────────────────────────
    if command in _DISPLAY_ONLY:
        return "❌ CLI display setting — not applicable in Discord."

    # ── Nick ──────────────────────────────────────────────────────────────────
    if command in _CLI_ONLY:
        return "❌ Nickname settings are CLI-only."

    # ── Session reset ─────────────────────────────────────────────────────────
    if command in _RESET_COMMANDS:
        return GATEWAY_RESET

    # ── Model / backend ───────────────────────────────────────────────────────
    if command in ("model", "backend"):
        if not args:
            current = get_gateway_agent()
            return f"🤖 Current gateway agent: **{current}**\nKnown agents: {', '.join(GATEWAY_AGENTS)}"
        name = args.strip().lower()
        if name not in GATEWAY_AGENTS:
            return (
                f"❌ Unknown agent `{name}`.\n"
                f"Known agents: {', '.join(GATEWAY_AGENTS)}"
            )
        set_gateway_agent(name)
        return f"✅ Gateway agent set to **{name}**. Changes take effect on the next message."

    # ── Models list ───────────────────────────────────────────────────────────
    if command == "models":
        return "Known gateway agents: " + ", ".join(GATEWAY_AGENTS)

    # ── Sessions summary ──────────────────────────────────────────────────────
    if command == "sessions":
        history = session_mgr.get_history_for_runner(channel_id)
        if not history:
            return "📭 No session history for this channel yet."
        lines: list[str] = [f"📜 Last {len(history)} turn(s) in this channel:"]
        for i, entry in enumerate(history, 1):
            role = entry.get("role", "?")
            text = entry.get("content", "")
            preview = text[:80].replace("\n", " ")
            ellipsis = "…" if len(text) > 80 else ""
            lines.append(f"  {i}. [{role}] {preview}{ellipsis}")
        return "\n".join(lines)

    # ── Help ──────────────────────────────────────────────────────────────────
    if command == "help":
        tool_names: list[str] = []
        skill_names: list[str] = []
        if TOOLS_DIR.exists():
            tool_names = sorted(d.name.lower() for d in TOOLS_DIR.iterdir() if d.is_dir())
        if SKILLS_DIR.exists():
            skill_names = sorted(d.name.lower() for d in SKILLS_DIR.iterdir() if d.is_dir())

        lines = ["**Yips Discord Commands**", ""]
        lines.append("**Built-in:**")
        for name in sorted(_BUILTIN_NAMES):
            lines.append(f"  `/{name}`")
        if tool_names:
            lines.append("")
            lines.append("**Tools:**")
            for name in tool_names:
                lines.append(f"  `/{name}`")
        if skill_names:
            lines.append("")
            lines.append("**Skills:**")
            for name in skill_names:
                lines.append(f"  `/{name}`")
        return "\n".join(lines)

    # ── Dynamic tool / skill lookup ───────────────────────────────────────────
    cmd_dir: Path | None = None

    # Priority 1: tools directory
    if TOOLS_DIR.exists():
        cmd_dir = next(
            (d for d in TOOLS_DIR.iterdir() if d.is_dir() and d.name.lower() == command),
            None,
        )
    # Priority 2: skills directory
    if cmd_dir is None and SKILLS_DIR.exists():
        cmd_dir = next(
            (d for d in SKILLS_DIR.iterdir() if d.is_dir() and d.name.lower() == command),
            None,
        )

    if cmd_dir is not None:
        output_parts: list[str] = []

        # Optional markdown context header
        md_path = cmd_dir / f"{cmd_dir.name}.md"
        if md_path.exists():
            try:
                output_parts.append(md_path.read_text(encoding="utf-8").strip())
            except Exception as exc:
                output_parts.append(f"⚠️ Could not read `/{command}` docs: {exc}")

        # Python executable
        py_path = cmd_dir / f"{cmd_dir.name}.py"
        if py_path.exists():
            tool_output = _run_tool(py_path, args, channel_id, session_mgr)

            # Propagate sentinel values immediately
            if tool_output in (GATEWAY_RESET,) or tool_output.startswith(GATEWAY_REPROMPT_PREFIX):
                return tool_output

            if tool_output:
                output_parts.append(tool_output)

        if output_parts:
            return "\n\n".join(output_parts)

        # Directory found but nothing executable/readable — fall through to unknown
        return f"❌ `/{command}` has no runnable content."

    # ── Unknown command ────────────────────────────────────────────────────────
    available_text = _available_commands_text()
    return f"❓ Unknown command: `/{command}`\n{available_text}"
