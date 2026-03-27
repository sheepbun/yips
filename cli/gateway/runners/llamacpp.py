"""Stateless runner for the local llama.cpp server (OpenAI-compatible API)."""

from __future__ import annotations

import json
import logging
from typing import Any

import requests

from cli.gateway.runners.base import AgentRunner
from cli.gateway.tools import (
    GATEWAY_TOOLS_DISCORD_READ_ONLY,
    GATEWAY_TOOLS_EDIT,
    GATEWAY_TOOLS_READ_ONLY,
    MAX_TOOL_ITERATIONS,
    execute_gateway_tool,
)

DEFAULT_TIMEOUT = 120

log = logging.getLogger(__name__)


class LlamaCppRunner(AgentRunner):
    """Send a single-turn chat completion to the running llama.cpp server."""

    def __init__(self) -> None:
        # Import lazily so the module can be loaded without llamacpp being installed
        from cli.llamacpp import get_llama_server_url
        self._base_url = get_llama_server_url()

    # ------------------------------------------------------------------
    #  Simple (no tools) request — used as fallback
    # ------------------------------------------------------------------

    def _simple_completion(self, url: str, messages: list[dict]) -> str:
        """Single-shot completion without tool schemas."""
        payload = {
            "messages": messages,
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
        url = f"{self._base_url}/v1/chat/completions"

        # Build message list: optional Discord context block → few-shot demo → history → current prompt
        messages: list[dict] = []
        if message_context:
            messages.append({
                "role": "system",
                "content": _format_discord_context_block(message_context),
            })
            # Inject a synthetic few-shot example so the model sees the correct
            # mention behaviour demonstrated rather than just instructed.
            # This is placed after the system block and before real history so it
            # acts as a prior exchange that establishes the pattern.
            messages.append({
                "role": "user",
                "content": "Can you ping ExampleUser for me?",
            })
            messages.append({
                "role": "assistant",
                "content": "Sure! Looking them up now.",
            })
            messages.append({
                "role": "user",
                "content": (
                    "[tool: discord_get_member('ExampleUser') → "
                    "{\"id\": \"900000000000000001\", \"display_name\": \"ExampleUser\"}]"
                ),
            })
            messages.append({
                "role": "assistant",
                "content": "Got their ID. Formatting the mention tag.",
            })
            messages.append({
                "role": "user",
                "content": (
                    "[tool: discord_format_mention('900000000000000001') → "
                    "<@900000000000000001>]"
                ),
            })
            messages.append({
                "role": "assistant",
                "content": (
                    "<@900000000000000001> — hey, Katherine wants your attention here!"
                ),
            })
        if history:
            for entry in history:
                # Strip metadata key before sending to the API
                messages.append({
                    "role": entry["role"],
                    "content": entry.get("content", ""),
                })
        messages.append({"role": "user", "content": prompt})

        tools = GATEWAY_TOOLS_EDIT if can_edit else GATEWAY_TOOLS_READ_ONLY
        if message_context:
            tools = tools + GATEWAY_TOOLS_DISCORD_READ_ONLY

        last_text = ""
        tool_results: list[str] = []  # collect for fallback

        for iteration in range(MAX_TOOL_ITERATIONS):
            payload: dict = {
                "messages": messages,
                "max_tokens": 2048,
                "temperature": 0.7,
                "tools": tools,
            }

            resp = requests.post(url, json=payload, timeout=DEFAULT_TIMEOUT)
            resp.raise_for_status()

            data = resp.json()
            choices = data.get("choices", [])
            if not choices:
                raise RuntimeError("llama.cpp returned no choices")

            choice = choices[0]
            assistant_msg = choice.get("message", {})
            finish_reason = choice.get("finish_reason", "")

            # Extract text content (may be None when only tool calls are present)
            text_content = (assistant_msg.get("content") or "").strip()
            if text_content:
                last_text = text_content

            tool_calls = assistant_msg.get("tool_calls")

            log.debug(
                "iteration=%d finish_reason=%r text=%r tool_calls=%r",
                iteration, finish_reason, text_content[:120] if text_content else "", tool_calls,
            )

            # No tool calls, or model signalled stop → return text
            if not tool_calls or finish_reason == "stop":
                return last_text or "(no response)"

            # Validate tool calls — if any are malformed, treat as text-only
            valid_calls = []
            for tc in tool_calls:
                func = tc.get("function", {})
                name = func.get("name", "")
                if not name:
                    log.debug("Skipping malformed tool call (no name): %r", tc)
                    continue
                valid_calls.append(tc)

            if not valid_calls:
                # All tool calls were malformed — model likely doesn't support tools.
                # Fall back to a simple completion without tool schemas.
                log.debug("No valid tool calls — falling back to simple completion")
                if last_text:
                    return last_text
                return self._simple_completion(url, messages)

            # Build the assistant message we append to history.
            # Use only the validated calls so llama.cpp doesn't choke on replays.
            history_msg: dict = {"role": "assistant", "content": text_content or None}
            history_msg["tool_calls"] = valid_calls
            messages.append(history_msg)

            # Execute each tool call and append results
            for tc in valid_calls:
                func = tc.get("function", {})
                tool_name = func.get("name", "")

                # Parse arguments — may be a JSON string or already a dict
                raw_args = func.get("arguments", "{}")
                if isinstance(raw_args, str):
                    try:
                        tool_args = json.loads(raw_args)
                    except json.JSONDecodeError:
                        tool_args = {}
                else:
                    tool_args = raw_args

                result = execute_gateway_tool(
                    tool_name, tool_args, can_edit, message_context=message_context
                )
                tool_results.append(f"[{tool_name}] {result}")

                log.debug("tool %s(%r) → %s", tool_name, tool_args, result[:200])

                # Build tool result message
                tool_msg: dict = {
                    "role": "tool",
                    "content": result,
                }
                tc_id = tc.get("id")
                if tc_id:
                    tool_msg["tool_call_id"] = tc_id
                # Some llama.cpp builds require name on tool messages
                tool_msg["name"] = tool_name

                messages.append(tool_msg)

        # Exhausted iterations — try one final completion without tools
        # so the model can summarise what it found
        log.debug("Tool loop exhausted — requesting final summary without tools")
        try:
            summary = self._simple_completion(url, messages)
            if summary:
                return summary
        except Exception:
            pass

        # Ultimate fallback: return collected tool results
        if tool_results:
            return "\n\n".join(tool_results)
        return (last_text or "(no response)") + f"\n\n(Warning: tool loop reached {MAX_TOOL_ITERATIONS} iterations limit)"


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _format_discord_context_block(ctx: dict[str, Any]) -> str:
    """Format a DiscordMessageContext dict into a human-readable system block."""
    lines = [
        "[Discord context]",
        "To ping/mention a user: (1) call discord_get_member to get their id, "
        "(2) call discord_format_mention with that id — it returns the tag, "
        "(3) paste the tag into your reply. Your reply IS the Discord message.",
    ]

    guild_id = ctx.get("guild_id")
    guild_name = ctx.get("guild_name")
    if guild_name or guild_id:
        guild_str = guild_name or ""
        if guild_id:
            guild_str += f" (id={guild_id})"
        lines.append(f"Server: {guild_str.strip()}")

    channel_name = ctx.get("channel_name", "")
    channel_id = ctx.get("channel_id", "")
    channel_type = ctx.get("channel_type", "")
    ch_str = f"#{channel_name}" if channel_name else ""
    if channel_id:
        ch_str += f" (id={channel_id}"
        if channel_type:
            ch_str += f", type={channel_type}"
        ch_str += ")"
    if ch_str:
        lines.append(f"Channel: {ch_str}")

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
