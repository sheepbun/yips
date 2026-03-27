"""Stateless runner for the Claude Code CLI (`claude --print`)."""

import shutil
import subprocess

from cli.gateway.runners.base import AgentRunner

DEFAULT_TIMEOUT = 120


class ClaudeCodeRunner(AgentRunner):
    def __init__(self, bin_path: str = "") -> None:
        self._bin = bin_path.strip() or shutil.which("claude") or "claude"

    def run(self, prompt: str, *, can_edit: bool = False) -> str:
        result = subprocess.run(
            [self._bin, "--print"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=DEFAULT_TIMEOUT,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"claude exited {result.returncode}")
        return result.stdout.strip()
