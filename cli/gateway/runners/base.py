"""Abstract base for stateless gateway agent runners."""

from abc import ABC, abstractmethod


class AgentRunner(ABC):
    @abstractmethod
    def run(self, prompt: str, *, can_edit: bool = False) -> str:
        """Run the agent with a single prompt and return its response."""
        ...
