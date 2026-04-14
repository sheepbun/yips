"""
Headless ReAct harness shared by the gateway runners (and reusable by the TUI).

Mirrors the behavior of cli.main.process_response_and_tools without Rich Live
rendering, console printing, or GUI branching. Callers provide:

  * `messages`       — an OpenAI-style chat history that the harness mutates in
                        place as it appends assistant turns, observation messages,
                        and reprompt messages.
  * `model_call`     — a function that takes the current messages and returns
                        the next assistant text.
  * `execute_tool_fn` — a function that executes a parsed ToolRequest and
                        returns a text result.
  * `session_state`  — a dict used for error_count / thought_signature /
                        last_action tracking across turns.

The harness owns: tool-tag parsing, per-turn observation formatting, depth
tracking, error counting, pivot-on-error reprompt injection, and the
INTERNAL_REPROMPT cycle. Returns the final cleaned assistant text.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from cli.config import DEFAULT_MAX_DEPTH, INTERNAL_REPROMPT
from cli.tool_execution import clean_response, parse_tool_requests
from cli.type_defs import ToolRequest

log = logging.getLogger(__name__)


ModelCall = Callable[[list[dict[str, Any]]], str]
ExecuteTool = Callable[[ToolRequest], str]
OnToolEnd = Callable[[str, Any, str], None]


def run_harness(
    *,
    messages: list[dict[str, Any]],
    initial_response: str,
    model_call: ModelCall,
    execute_tool_fn: ExecuteTool,
    session_state: dict[str, Any] | None = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
    on_tool_end: OnToolEnd | None = None,
) -> str:
    """Run the ReAct loop starting from `initial_response`.

    The initial model call has already happened; its text is `initial_response`.
    The harness parses it for tool tags, executes them, appends an observation
    turn, asks the model for the next response, and loops until no more tags
    are emitted or max_depth is reached.

    `messages` is mutated in place so the caller can persist the full trail.
    """
    if session_state is None:
        session_state = {}

    current_response = initial_response
    messages.append({"role": "assistant", "content": current_response})

    for _ in range(max_depth):
        tool_requests = parse_tool_requests(current_response)
        if not tool_requests:
            return clean_response(current_response)

        observations: list[str] = []
        has_explicit_reprompt = False
        explicit_reprompt_msg = ""

        for request in tool_requests:
            if request["type"] == "thought":
                session_state["thought_signature"] = str(request.get("signature", ""))
                continue

            tool_name = "unknown"
            params: Any = ""
            if request["type"] == "action":
                tool_name = str(request["tool"])
                params = request["params"]
            elif request["type"] == "identity":
                tool_name = "update_identity"
                params = request["reflection"]
            elif request["type"] == "skill":
                tool_name = str(request["skill"])
                params = request["args"]

            try:
                result = execute_tool_fn(request)
            except Exception as exc:
                log.exception("tool %s raised in harness", tool_name)
                result = f"[Error executing {tool_name}: {exc}]"

            if on_tool_end is not None:
                try:
                    on_tool_end(tool_name, params, result)
                except Exception:
                    log.exception("on_tool_end hook failed")

            lower_result = result.lower()
            if "[error" in lower_result or "failed" in lower_result:
                session_state["error_count"] = session_state.get("error_count", 0) + 1
            else:
                session_state["error_count"] = 0

            session_state["last_action"] = f"{tool_name}: {params}"

            if result.startswith("::YIPS_REPROMPT::"):
                has_explicit_reprompt = True
                explicit_reprompt_msg = result[len("::YIPS_REPROMPT::"):]
                observations.append(f"[Observation: {tool_name}] {explicit_reprompt_msg}")
            else:
                observations.append(
                    f"[Observation: {tool_name}({params})]\n{result}"
                )

        # Compose a single user message combining observations + reprompt guidance.
        # This keeps strict role alternation (user/assistant) which llama.cpp
        # requires for some model families.
        if has_explicit_reprompt:
            reprompt_guidance = explicit_reprompt_msg
        else:
            error_count = session_state.get("error_count", 0)
            if error_count > 1:
                reprompt_guidance = (
                    f"Observation received. NOTE: You have encountered {error_count} "
                    f"consecutive error(s). If your current approach is failing, consider "
                    f"a different tool or strategy (Pivot)."
                )
            else:
                reprompt_guidance = INTERNAL_REPROMPT

        combined = "\n\n".join(observations) + f"\n\n{reprompt_guidance}"
        messages.append({"role": "user", "content": combined})

        try:
            current_response = model_call(messages)
        except Exception as exc:
            log.exception("model_call failed inside harness")
            return clean_response(current_response) or f"[Error: model call failed: {exc}]"

        messages.append({"role": "assistant", "content": current_response})

    # Depth limit hit — return best available text
    cleaned = clean_response(current_response)
    suffix = f"\n\n(Harness reached max depth {max_depth}; returning last response.)"
    return (cleaned + suffix) if cleaned else suffix.strip()


def serialize_observations(messages: list[dict[str, Any]]) -> str:
    """Utility: JSON-serialize the harness-appended messages for logging."""
    try:
        return json.dumps(messages, indent=2, default=str)
    except Exception:
        return repr(messages)
