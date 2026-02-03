"""
Context loading logic for YipsAgent.
"""

import json
import subprocess
from pathlib import Path
from cli.config import BASE_DIR, DOT_YIPS_DIR, MEMORIES_DIR, TOOLS_DIR, SKILLS_DIR


class AgentContextMixin:
    """Mixin providing context loading capabilities to YipsAgent."""

    def load_context(self) -> str:
        """Load all context documents into a system prompt."""
        sections: list[str] = []

        # Soul document
        agent_md = BASE_DIR / "AGENT.md"
        if agent_md.exists():
            sections.append(f"# SOUL DOCUMENT\n\n{agent_md.read_text()}")

        # Identity
        identity_md = BASE_DIR / "IDENTITY.md"
        if identity_md.exists():
            sections.append(f"# IDENTITY\n\n{identity_md.read_text()}")

        # Human info
        human_md = BASE_DIR / "author" / "HUMAN.md"
        if human_md.exists():
            sections.append(f"# ABOUT KATHERINE\n\n{human_md.read_text()}")

        # Specifications
        specs_md = BASE_DIR / "system" / "SPECIFICATIONS.md"
        if specs_md.exists():
            sections.append(f"# SPECIFICATIONS\n\n{specs_md.read_text()}")

        # Focus Area
        focus_md = DOT_YIPS_DIR / "FOCUS.md"
        if focus_md.exists():
            sections.append(f"# CURRENT FOCUS AREA\n\n{focus_md.read_text()}")

        # User Preferences
        pref_json = DOT_YIPS_DIR / "preferences.json"
        if pref_json.exists():
            try:
                prefs = json.loads(pref_json.read_text())
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
            memories = sorted(MEMORIES_DIR.glob("*.md"), reverse=True)[:5]
            if memories:
                mem_content: list[str] = []
                for mem in memories:
                    mem_content.append(f"## {mem.stem}\n{mem.read_text()}")
                sections.append(f"# RECENT MEMORIES\n\n" + "\n\n".join(mem_content))

        # Available commands
        available_cmds = []
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
        if hasattr(self, 'session_state') and self.session_state.get("thought_signature"):
            sections.append(f"# CURRENT TASK PLAN (Thought Signature)\n\n{self.session_state['thought_signature']}")

        return "\n\n" + "=" * 60 + "\n\n".join(sections)

    def _estimate_tokens(self, system_prompt: str, messages: list[dict] | str) -> int:
        """Estimate token count for prompt."""
        if isinstance(messages, str):
            text = system_prompt + messages
        else:
            text = system_prompt
            for msg in messages:
                text += str(msg.get("content", ""))
        
        # Rough estimate: 1 token ~= 4 chars
        return len(text) // 4