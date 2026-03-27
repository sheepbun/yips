"""
Context loading logic for YipsAgent.
"""

from __future__ import annotations

import json
import platform
import subprocess
from typing import TYPE_CHECKING, Any
from cli.config import BASE_DIR, DOT_YIPS_DIR, MEMORIES_DIR, TOOLS_DIR, SKILLS_DIR, load_config
from cli.version import get_version
from cli.hw_utils import get_system_specs

if TYPE_CHECKING:
    from cli.type_defs import YipsAgentProtocol, Message


class AgentContextMixin:
    """Mixin providing context loading capabilities to YipsAgent."""

    def build_system_info(self: YipsAgentProtocol) -> str:
        """Build dynamic system information section."""
        config = load_config()
        specs = get_system_specs()
        version = get_version()

        lines = [
            f"- **Agent**: Yips {version}",
            f"- **Backend**: {config.get('backend', 'unknown')}",
            f"- **Model**: {config.get('model', 'unknown')}",
            f"- **Streaming**: {'enabled' if config.get('streaming', True) else 'disabled'}",
            f"- **RAM**: {specs['ram_gb']} GB",
        ]

        if specs["vram_gb"] > 0:
            gpu = specs.get("gpu_type") or "unknown"
            lines.append(f"- **VRAM**: {specs['vram_gb']} GB ({gpu})")

        if hasattr(self, 'token_limits'):
            max_tok = self.token_limits.get('max_tokens', 0)
            threshold = self.token_limits.get('pruning_threshold', 0)
            lines.append(f"- **Context Limit**: {max_tok} tokens")
            lines.append(f"- **Pruning Threshold**: {threshold} tokens")

            # Estimate current context usage from conversation history
            if hasattr(self, 'conversation_history'):
                used = self.estimate_tokens("", self.conversation_history)
                if hasattr(self, 'running_summary') and self.running_summary:
                    used += len(self.running_summary) // 3
                pct = round(used / max_tok * 100) if max_tok else 0
                lines.append(f"- **Context Used**: ~{used}/{max_tok} tokens ({pct}%)")

        lines.append(f"- **Platform**: {platform.system().lower()}")
        lines.append(f"- **Working Directory**: {BASE_DIR}")

        return "# SYSTEM INFORMATION\n\n" + "\n".join(lines)

    def load_context(self: YipsAgentProtocol) -> str:
        """Load all context documents into a system prompt."""
        sections: list[str] = []

        # Soul document
        agent_md = BASE_DIR / "AGENT.md"
        if agent_md.exists():
            sections.append(f"# SOUL DOCUMENT\n\n{agent_md.read_text(encoding='utf-8')}")

        # Identity
        identity_md = BASE_DIR / "IDENTITY.md"
        if identity_md.exists():
            sections.append(f"# IDENTITY\n\n{identity_md.read_text(encoding='utf-8')}")

        # Human info
        human_md = BASE_DIR / "author" / "HUMAN.md"
        if human_md.exists():
            sections.append(f"# ABOUT KATHERINE\n\n{human_md.read_text(encoding='utf-8')}")

        # System Information (dynamic)
        sections.append(self.build_system_info())

        # Focus Area
        focus_md = DOT_YIPS_DIR / "FOCUS.md"
        if focus_md.exists():
            sections.append(f"# CURRENT FOCUS AREA\n\n{focus_md.read_text(encoding='utf-8')}")

        # User Preferences
        pref_json = DOT_YIPS_DIR / "preferences.json"
        if pref_json.exists():
            try:
                prefs = json.loads(pref_json.read_text(encoding='utf-8'))
                sections.append(f"# USER PREFERENCES\n\n{json.dumps(prefs, indent=2)}")
            except Exception:
                pass

        # Recent Git Activity (Last 5 commits)
        try:
            git_log = subprocess.run(
                ["git", "log", "-n", "5", "--oneline"],
                capture_output=True,
                text=True,
                cwd=BASE_DIR
            )
            if git_log.returncode == 0 and git_log.stdout:
                sections.append(f"# RECENT GIT COMMITS\n\n{git_log.stdout}")
        except Exception:
            pass

        # Recent memories (last 5)
        if MEMORIES_DIR.exists():
            current_session = getattr(self, 'session_file_path', None)
            memories = sorted(MEMORIES_DIR.glob("*.md"), reverse=True)[:5]
            if memories:
                mem_content: list[str] = []
                for mem in memories:
                    if current_session and mem.resolve() == current_session.resolve():
                        continue  # Don't feed the model its own in-progress conversation
                    mem_content.append(f"## {mem.stem}\n{mem.read_text(encoding='utf-8')}")
                if mem_content:
                    sections.append(f"# RECENT MEMORIES\n\n" + "\n\n".join(mem_content))

        # Available commands
        available_cmds: list[str] = []
        if TOOLS_DIR.exists():
            available_cmds.extend([d.name.lower() for d in TOOLS_DIR.iterdir() if d.is_dir()])
        if SKILLS_DIR.exists():
            available_cmds.extend([d.name.lower() for d in SKILLS_DIR.iterdir() if d.is_dir()])
            
        if available_cmds:
            cmd_names = [f"/{c}" for c in sorted(list(set(available_cmds)))]
            sections.append(
                f"# USER COMMANDS\n\nKatherine can use these slash commands in the terminal: {', '.join(cmd_names)}\n\n"
                "IMPORTANT: As an agent, you MUST NOT use slash commands. To use a tool or skill yourself, "
                "you MUST use the {INVOKE_SKILL:SKILL_NAME:args} or {ACTION:TOOL_NAME:params} syntax as defined in your soul document."
            )

        # Thought Signature / Current Task State
        thought = self.session_state.get("thought_signature")
        if thought:
            sections.append(f"# CURRENT TASK PLAN (Thought Signature)\n\n{thought}")

        return "\n\n" + "=" * 60 + "\n\n".join(sections)

    def estimate_tokens(self: YipsAgentProtocol, system_prompt: str, messages: list[Message] | list[dict[str, Any]] | str) -> int:
        """Estimate token count for prompt."""
        if isinstance(messages, str):
            text = system_prompt + messages
        else:
            text = system_prompt
            # Handle both list[Message] and list[dict[str, Any]]
            for msg in messages:
                # Accessing content safely for TypedDict/dict
                # (msg is guaranteed to be a dict by the type hint)
                content = msg.get("content", "")
                text += str(content)
        
        # Rough estimate: 1 token ~= 3 chars (conservative)
        return len(text) // 3