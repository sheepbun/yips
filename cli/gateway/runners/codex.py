"""Stateless runner for the OpenAI Codex CLI (`codex --approval-mode full-auto`)."""

import os
import shutil
import subprocess

from cli.gateway.runners.base import AgentRunner

DEFAULT_TIMEOUT = 180


class CodexRunner(AgentRunner):
    def __init__(self, bin_path: str = "", api_key: str = "") -> None:
        self._bin = bin_path.strip() or shutil.which("codex") or "codex"
        self._api_key = api_key.strip()

    def run(self, prompt: str, *, can_edit: bool = False) -> str:
        env = {**os.environ}
        if self._api_key:
            env["OPENAI_API_KEY"] = self._api_key
        result = subprocess.run(
            [self._bin, "--approval-mode", "full-auto"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=DEFAULT_TIMEOUT,
            env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"codex exited {result.returncode}")
        return result.stdout.strip()
