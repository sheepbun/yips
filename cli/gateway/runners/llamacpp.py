"""Stateless runner for the local llama.cpp server (OpenAI-compatible API)."""

from __future__ import annotations

import json
import logging

import requests

from cli.gateway.runners.base import AgentRunner
from cli.gateway.tools import (
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

    def run(self, prompt: str, *, can_edit: bool = False) -> str:
        url = f"{self._base_url}/v1/chat/completions"
        messages: list[dict] = [{"role": "user", "content": prompt}]
        tools = GATEWAY_TOOLS_EDIT if can_edit else GATEWAY_TOOLS_READ_ONLY

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

                result = execute_gateway_tool(tool_name, tool_args, can_edit)
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
