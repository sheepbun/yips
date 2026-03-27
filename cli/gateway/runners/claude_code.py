"""Stateless runner for the Claude Code CLI (`claude --print`)."""

import shutil
import subprocess
from typing import Any

from cli.gateway.runners.base import AgentRunner

DEFAULT_TIMEOUT = 120


class ClaudeCodeRunner(AgentRunner):
    def __init__(self, bin_path: str = "") -> None:
        self._bin = bin_path.strip() or shutil.which("claude") or "claude"

    def run(
        self,
        prompt: str,
        *,
        can_edit: bool = False,
        history: list[dict[str, Any]] | None = None,
        message_context: dict[str, Any] | None = None,
    ) -> str:
        full_prompt = _build_prefixed_prompt(prompt, history, message_context)
        result = subprocess.run(
            [self._bin, "--print"],
            input=full_prompt,
            capture_output=True,
            text=True,
            timeout=DEFAULT_TIMEOUT,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"claude exited {result.returncode}")
        return result.stdout.strip()


def _build_prefixed_prompt(
    prompt: str,
    history: list[dict[str, Any]] | None,
    message_context: dict[str, Any] | None,
) -> str:
    """Serialize optional Discord context and history into a plain-text prompt prefix.

    When both *history* and *message_context* are None the original *prompt* is
    returned unchanged so non-Discord callers see no regression.
    """
    if not history and not message_context:
        return prompt

    parts: list[str] = []

    if message_context:
        lines = [
            "[Discord context]",
            "To ping/mention a user: (1) call discord_get_member to get their id, "
            "(2) call discord_format_mention with that id — it returns the tag, "
            "(3) paste the tag into your reply. Your reply IS the Discord message.",
        ]
        guild_name = message_context.get("guild_name")
        guild_id = message_context.get("guild_id")
        if guild_name or guild_id:
            g = guild_name or ""
            if guild_id:
                g += f" (id={guild_id})"
            lines.append(f"Server: {g.strip()}")
        channel_name = message_context.get("channel_name", "")
        channel_id = message_context.get("channel_id", "")
        channel_type = message_context.get("channel_type", "")
        ch = f"#{channel_name}" if channel_name else ""
        if channel_id:
            ch += f" (id={channel_id}"
            if channel_type:
                ch += f", type={channel_type}"
            ch += ")"
        if ch:
            lines.append(f"Channel: {ch}")
        author_display = message_context.get("author_display_name", "")
        author_id = message_context.get("author_id", "")
        a = author_display or ""
        if author_id:
            a += f" (id={author_id})"
        if a:
            lines.append(f"Author: {a.strip()}")
        if message_context.get("is_bot_mentioned"):
            lines.append("Note: The bot was @mentioned in this message.")
        reply_to = message_context.get("reply_to_message_id")
        if reply_to:
            lines.append(f"This message is a reply to message id={reply_to}")
        parts.append("\n".join(lines))

    if message_context:
        # Few-shot example demonstrating the mention/ping pattern
        parts.append(
            "[Example interaction — ping workflow]\n"
            "USER: Can you ping ExampleUser for me?\n"
            "ASSISTANT: Sure, looking them up.\n"
            "[calls discord_get_member('ExampleUser') → {\"id\": \"900000000000000001\"}]\n"
            "Got their ID. Getting the mention tag.\n"
            "[calls discord_format_mention('900000000000000001') → <@900000000000000001>]\n"
            "ASSISTANT: <@900000000000000001> — hey, Katherine wants your attention!\n"
            "[End example]"
        )

    if history:
        hist_lines = ["[Conversation history]"]
        for entry in history:
            role = entry.get("role", "user").upper()
            content = entry.get("content", "")
            hist_lines.append(f"{role}: {content}")
        parts.append("\n".join(hist_lines))

    parts.append(prompt)
    return "\n\n".join(parts)
