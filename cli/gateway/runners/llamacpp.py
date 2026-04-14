"""Stateless runner for the local llama.cpp server (OpenAI-compatible API).

Routes gateway prompts through the shared ReAct harness (cli.harness) so that
Discord messages get the same tool-use loop the TUI uses: text-based
`{ACTION:tool:params}` parsing, observation reprompts, pivot-on-error, and
depth-limited recursion. The harness replaced the older OpenAI
function-calling tool loop that lived in this file.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import requests

from cli.config import BASE_DIR, DEFAULT_MAX_DEPTH, SKILLS_DIR, TOOLS_DIR, load_config
from cli.gateway.runners.base import AgentRunner
from cli.harness import run_harness
from cli.tool_execution import execute_tool
from cli.type_defs import ToolRequest

DEFAULT_TIMEOUT = 120

log = logging.getLogger(__name__)


# Action names the harness's text-based grammar will accept in the gateway.
_GATEWAY_READ_ONLY_ACTIONS: set[str] = {
    "read_file",
    "ls",
    "grep",
}
_GATEWAY_EDIT_ACTIONS: set[str] = _GATEWAY_READ_ONLY_ACTIONS | {
    "write_file",
    "edit_file",
    "run_command",
    "git",
    "sed",
    "create_plan",
}
# Skills / tools blocked in Discord regardless of permission level:
#   VT      — interactive, needs a TTY; pauses Rich Live (not applicable over Discord)
#   EXIT    — would kill the Yips process and take the bot down for every user
#   EXAMPLE — placeholder demo, not a real skill
_GATEWAY_SKILL_BLOCKLIST: set[str] = {"VT", "EXIT", "EXAMPLE"}

_DISCORD_ACTION_NAMES: set[str] = {
    "discord_get_server_context",
    "discord_list_members",
    "discord_get_member",
    "discord_list_channels",
    "discord_list_roles",
    "discord_format_mention",
}


def _discover_gateway_skills() -> set[str]:
    """Enumerate <NAME>/<NAME>.py entries under SKILLS_DIR and TOOLS_DIR,
    minus the gateway block-list. These map to `{INVOKE_SKILL:NAME:args}`."""
    names: set[str] = set()
    for root in (SKILLS_DIR, TOOLS_DIR):
        if not root.exists():
            continue
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            name = entry.name
            if name in _GATEWAY_SKILL_BLOCKLIST:
                continue
            if (entry / f"{name}.py").exists():
                names.add(name)
    return names


def _build_gateway_allowed_tools(can_edit: bool) -> tuple[set[str], set[str], set[str]]:
    """Return (actions, skills, combined_allow_list) for this gateway call.

    The combined set is what's passed to execute_tool's `allowed_tools` gate;
    the split sets are used to render the system prompt's action/skill menu.
    """
    actions = set(_GATEWAY_EDIT_ACTIONS if can_edit else _GATEWAY_READ_ONLY_ACTIONS)
    skills = _discover_gateway_skills()
    combined = actions | skills | {"update_identity"}
    return actions, skills, combined


class LlamaCppRunner(AgentRunner):
    """Send a harness-driven chat loop to the running llama.cpp server."""

    def __init__(self) -> None:
        from cli.llamacpp import get_llama_server_url
        self._base_url = get_llama_server_url()

    # ------------------------------------------------------------------
    #  Low-level completion call
    # ------------------------------------------------------------------

    def _completion(self, messages: list[dict[str, Any]]) -> str:
        """Single-shot completion without tool schemas."""
        url = f"{self._base_url}/v1/chat/completions"
        payload = {
            "messages": _merge_consecutive_roles(messages),
            "max_tokens": 2048,
            "temperature": 0.7,
        }
        resp = requests.post(url, json=payload, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("llama.cpp returned no choices")
        return (choices[0].get("message", {}).get("content") or "").strip()

    # ------------------------------------------------------------------
    #  Main entry point
    # ------------------------------------------------------------------

    def run(
        self,
        prompt: str,
        *,
        can_edit: bool = False,
        history: list[dict[str, Any]] | None = None,
        message_context: dict[str, Any] | None = None,
    ) -> str:
        allowed_actions, allowed_skills, allowed_tool_names = _build_gateway_allowed_tools(can_edit)

        messages: list[dict[str, Any]] = []
        messages.append({
            "role": "system",
            "content": _build_system_prompt(
                message_context=message_context,
                can_edit=can_edit,
                allowed_actions=allowed_actions,
                allowed_skills=allowed_skills,
            ),
        })

        if history:
            for entry in history:
                messages.append({
                    "role": entry["role"],
                    "content": entry.get("content", ""),
                })
        messages.append({"role": "user", "content": prompt})

        try:
            initial = self._completion(messages)
        except Exception as exc:
            log.exception("initial llama.cpp completion failed")
            return f"[Error: {exc}]"

        def model_call(msgs: list[dict[str, Any]]) -> str:
            return self._completion(msgs)

        def execute(req: ToolRequest) -> str:
            # Intercept Discord action names before delegating to execute_tool,
            # which is Discord-unaware.
            if req["type"] == "action":
                tool_name = str(req["tool"])
                if tool_name in _DISCORD_ACTION_NAMES:
                    return _execute_discord_action(
                        tool_name, str(req["params"]), message_context
                    )
            return execute_tool(
                req,
                agent=None,
                non_interactive=True,
                allowed_tools=allowed_tool_names,
            )

        max_depth = int(load_config().get("max_depth", DEFAULT_MAX_DEPTH))

        final_text = run_harness(
            messages=messages,
            initial_response=initial,
            model_call=model_call,
            execute_tool_fn=execute,
            max_depth=max_depth,
        )

        if not final_text.strip():
            return "(no response)"
        return final_text


# ---------------------------------------------------------------------------
#  System prompt builder
# ---------------------------------------------------------------------------


_ACTION_USAGE_HINTS: dict[str, str] = {
    "read_file": "{ACTION:read_file:path}",
    "ls": "{ACTION:ls:path}",
    "grep": "{ACTION:grep:pattern:path}",
    "write_file": "{ACTION:write_file:path:content}",
    "edit_file": "{ACTION:edit_file:path:::old_string:::new_string}",
    "run_command": "{ACTION:run_command:command}  (destructive patterns are blocked)",
    "git": "{ACTION:git:subcommand}",
    "sed": "{ACTION:sed:expression:path}",
    "create_plan": "{ACTION:create_plan:name:content}",
}


def _build_system_prompt(
    *,
    message_context: dict[str, Any] | None,
    can_edit: bool,
    allowed_actions: set[str],
    allowed_skills: set[str],
) -> str:
    """Build the system prompt: soul document + tool grammar + Discord context."""
    sections: list[str] = []

    agent_md = BASE_DIR / "AGENT.md"
    if agent_md.exists():
        sections.append(agent_md.read_text(encoding="utf-8"))

    identity_md = BASE_DIR / "IDENTITY.md"
    if identity_md.exists():
        sections.append(f"# IDENTITY\n\n{identity_md.read_text(encoding='utf-8')}")

    tool_notes = [
        "# GATEWAY RUNTIME",
        "",
        "You are being invoked through the Yips gateway (Discord). Responses are",
        "sent verbatim as the chat reply. Keep replies concise for chat.",
        "",
        "Tool calls use the exact grammar taught above: `{ACTION:tool:params}`,",
        "`{INVOKE_SKILL:NAME:args}`, `{UPDATE_IDENTITY:reflection}`. Results come",
        "back as `[Observation: tool(params)] ...` user messages. Parse those,",
        "then emit the next action or a final reply. When the task is done, emit",
        "a plain-text reply with NO action tags.",
        "",
        "Available actions in this context:",
    ]
    for name in sorted(allowed_actions):
        tool_notes.append(f"- {_ACTION_USAGE_HINTS.get(name, '{ACTION:' + name + ':params}')}")
    if not can_edit:
        tool_notes.append("(Write / exec tools are disabled for this user — no edit permission.)")

    if allowed_skills:
        tool_notes += [
            "",
            "Available skills in this context (invoke with `{INVOKE_SKILL:NAME:args}`):",
        ]
        for name in sorted(allowed_skills):
            tool_notes.append(f"- {name}")

    if message_context is not None:
        tool_notes += [
            "",
            "Discord-specific actions:",
            "- {ACTION:discord_get_server_context:}",
            "- {ACTION:discord_list_members:<optional substring>}",
            "- {ACTION:discord_get_member:<id or name substring>}",
            "- {ACTION:discord_list_channels:}",
            "- {ACTION:discord_list_roles:}",
            "- {ACTION:discord_format_mention:<user_id>}",
            "",
            "To ping a user: call discord_get_member to resolve their id,",
            "call discord_format_mention with that id, paste the returned",
            "`<@id>` tag verbatim into your reply. Your reply IS the message.",
        ]

    tool_notes += [
        "",
        "Safety rails: all file-system paths must be inside the working zone.",
        "Out-of-zone actions are auto-denied. Destructive shell commands are",
        "auto-denied regardless of permission.",
    ]
    sections.append("\n".join(tool_notes))

    if message_context is not None:
        sections.append(_format_discord_context_block(message_context))

    return "\n\n" + ("\n\n" + "=" * 60 + "\n\n").join(sections)


# ---------------------------------------------------------------------------
#  Discord tool dispatch
# ---------------------------------------------------------------------------


def _execute_discord_action(
    tool_name: str,
    params: str,
    message_context: dict[str, Any] | None,
) -> str:
    """Execute a Discord read-only tool from a text-grammar action request."""
    from cli.gateway import discord_runtime

    if message_context is None:
        return "[Error: Discord tools require a Discord message context]"

    guild_id = message_context.get("guild_id")
    if guild_id is None and tool_name != "discord_format_mention":
        return (
            "[Error: This is a direct message — server-level Discord tools "
            "are not available in DMs]"
        )

    params = params.strip()

    try:
        if tool_name == "discord_get_server_context":
            result = discord_runtime.get_guild(guild_id)
            if result is None:
                return "[Error: Guild not found or bot is not in that server]"
            return json.dumps(result, indent=2)

        if tool_name == "discord_list_members":
            # params may be "<query>" or "<query>:<limit>" or empty
            query: str | None = None
            limit = 25
            if params:
                if ":" in params:
                    q, lim = params.split(":", 1)
                    query = q.strip() or None
                    try:
                        limit = max(1, min(100, int(lim.strip())))
                    except ValueError:
                        pass
                else:
                    query = params
            members = discord_runtime.list_members(guild_id, query=query, limit=limit)
            return json.dumps(members, indent=2)

        if tool_name == "discord_get_member":
            if not params:
                return "[Error: discord_get_member requires an identifier]"
            member = discord_runtime.get_member(guild_id, params)
            if member is None:
                return f"[No member found matching '{params}']"
            return json.dumps(member, indent=2)

        if tool_name == "discord_list_channels":
            channels = discord_runtime.list_channels(guild_id)
            return json.dumps(channels, indent=2)

        if tool_name == "discord_list_roles":
            roles = discord_runtime.list_roles(guild_id)
            return json.dumps(roles, indent=2)

        if tool_name == "discord_format_mention":
            if not params:
                return "[Error: discord_format_mention requires a user_id]"
            return f"<@{params}>"

        return f"[Error: unknown Discord tool '{tool_name}']"

    except RuntimeError as exc:
        return f"[Error: {exc}]"
    except Exception as exc:
        return f"[Error executing {tool_name}: {exc}]"


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------


def _merge_consecutive_roles(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge adjacent messages of the same role (llama.cpp requires alternation
    for some models, e.g. Gemma-3)."""
    merged: list[dict[str, Any]] = []
    for msg in messages:
        if merged and merged[-1]["role"] == msg["role"]:
            merged[-1] = {
                "role": merged[-1]["role"],
                "content": str(merged[-1].get("content", ""))
                + "\n\n"
                + str(msg.get("content", "")),
            }
        else:
            merged.append(
                {"role": msg["role"], "content": str(msg.get("content", ""))}
            )
    return merged


def _format_discord_context_block(ctx: dict[str, Any]) -> str:
    """Human-readable Discord context block."""
    lines = ["# DISCORD CONTEXT"]

    guild_id = ctx.get("guild_id")
    guild_name = ctx.get("guild_name")
    if guild_name or guild_id:
        g = guild_name or ""
        if guild_id:
            g += f" (id={guild_id})"
        lines.append(f"Server: {g.strip()}")

    channel_name = ctx.get("channel_name", "")
    channel_id = ctx.get("channel_id", "")
    channel_type = ctx.get("channel_type", "")
    ch = f"#{channel_name}" if channel_name else ""
    if channel_id:
        ch += f" (id={channel_id}"
        if channel_type:
            ch += f", type={channel_type}"
        ch += ")"
    if ch:
        lines.append(f"Channel: {ch}")

    author_display = ctx.get("author_display_name", "")
    author_id = ctx.get("author_id", "")
    author_str = author_display or ""
    if author_id:
        author_str += f" (id={author_id})"
    if author_str:
        lines.append(f"Author: {author_str.strip()}")

    if ctx.get("is_bot_mentioned"):
        lines.append("Note: The bot was @mentioned in this message.")

    reply_to = ctx.get("reply_to_message_id")
    if reply_to:
        lines.append(f"This message is a reply to message id={reply_to}")

    return "\n".join(lines)
