"""Abstract base for stateless gateway agent runners."""

from abc import ABC, abstractmethod
from typing import Any


class AgentRunner(ABC):
    @abstractmethod
    def run(
        self,
        prompt: str,
        *,
        can_edit: bool = False,
        history: list[dict[str, Any]] | None = None,
        message_context: dict[str, Any] | None = None,
    ) -> str:
        """Run the agent with a single prompt and return its response."""
        ...
