"""Stateless runner for the OpenAI Codex CLI (`codex --approval-mode full-auto`)."""

import os
import shutil
import subprocess
from typing import Any

from cli.gateway.runners.base import AgentRunner
from cli.gateway.runners.claude_code import _build_prefixed_prompt

DEFAULT_TIMEOUT = 180


class CodexRunner(AgentRunner):
    def __init__(self, bin_path: str = "", api_key: str = "") -> None:
        self._bin = bin_path.strip() or shutil.which("codex") or "codex"
        self._api_key = api_key.strip()

    def run(
        self,
        prompt: str,
        *,
        can_edit: bool = False,
        history: list[dict[str, Any]] | None = None,
        message_context: dict[str, Any] | None = None,
    ) -> str:
        full_prompt = _build_prefixed_prompt(prompt, history, message_context)
        env = {**os.environ}
        if self._api_key:
            env["OPENAI_API_KEY"] = self._api_key
        result = subprocess.run(
            [self._bin, "--approval-mode", "full-auto"],
            input=full_prompt,
            capture_output=True,
            text=True,
            timeout=DEFAULT_TIMEOUT,
            env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"codex exited {result.returncode}")
        return result.stdout.strip()
