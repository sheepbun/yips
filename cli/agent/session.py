"""
Session and memory management for YipsAgent.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING
from cli.config import MEMORIES_DIR, DOT_YIPS_DIR
from cli.hw_utils import get_system_specs

if TYPE_CHECKING:
    from cli.type_defs import YipsAgentProtocol, Message


class AgentSessionMixin:
    """Mixin providing session and memory management to YipsAgent."""

    def _format_system_preview(self: YipsAgentProtocol, content: str, limit: int = 200) -> str:
        """Collapse system content to a single line preview safe for session files."""
        flattened = " ".join(content.split())
        return flattened[:limit] + "..." if len(flattened) > limit else flattened

    def calculate_context_limits(self: YipsAgentProtocol) -> None:
        """Calculate dynamic context limits based on available RAM."""
        # Defaults
        self.token_limits = {
            "max_tokens": 8192,
            "pruning_threshold": 6192,
            "prune_amount": 2000
        }

        # Check for user override
        pref_file = DOT_YIPS_DIR / "preferences.json"
        if pref_file.exists():
            try:
                prefs = json.loads(pref_file.read_text())
                if "max_context_tokens" in prefs:
                    max_tokens = int(prefs["max_context_tokens"])
                    self.token_limits["max_tokens"] = max_tokens
                    self.token_limits["pruning_threshold"] = max_tokens - 2000
                    self.token_limits["prune_amount"] = int(max_tokens * 0.25)
                    return
            except Exception:
                pass

        # Calculate based on hardware
        try:
            specs = get_system_specs()
            ram_gb = specs.get("ram_gb", 8)
            
            # Formula: (RAM - 6GB buffer) * 1500 tokens/GB
            # 6GB buffer covers OS (4GB) + Model overhead (~2GB min)
            available_gb = max(0, ram_gb - 6)
            calc_tokens = int(available_gb * 1500)
            
            # Clamp between 4k and 128k
            max_tokens = max(4096, min(128000, calc_tokens))
            
            self.token_limits["max_tokens"] = max_tokens
            self.token_limits["pruning_threshold"] = max(2048, max_tokens - 2000)
            self.token_limits["prune_amount"] = int(max_tokens * 0.25)

        except Exception:
            pass

    def generate_session_summary(self: YipsAgentProtocol) -> str:
        """Generate a short summary of the conversation for the session filename."""
        if not hasattr(self, 'conversation_history') or not self.conversation_history:
            return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

        # Build a summary prompt
        summary_prompt = (
            "Summarize this conversation in 3-5 words for a filename. "
            "Use lowercase words separated by underscores. No special characters. "
            "Example: 'fixing_memorize_naming' or 'debugging_api_errors'. "
            "Respond with ONLY the filename slug, nothing else."
        )

        try:
            # Call the AI with the summary prompt
            response = self.get_response(summary_prompt)

            # Sanitize the response
            slug = response.strip().lower()
            slug = re.sub(r'[^a-z0-9_\s]', '', slug)
            slug = re.sub(r'[\s]+', '_', slug)
            slug = slug[:50]  # Limit length

            if slug:
                return slug
        except Exception:
            # If summary generation fails, fall back to timestamp
            pass

        # Fallback to timestamp-based name
        return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"

    def generate_session_name_from_message(self: YipsAgentProtocol) -> str:
        """Generate session name from first user message."""
        if not hasattr(self, 'conversation_history'):
            return "session"
            
        # Find first user message in history
        for entry in self.conversation_history:
            if entry.get("role") == "user":
                message = entry.get("content", "")
                # Clean and truncate
                slug = message.lower().strip()
                # Remove non-alphanumeric (except spaces)
                slug = re.sub(r'[^a-z0-9\s]', '', slug)
                # Replace spaces with underscores
                slug = re.sub(r'\s+', '_', slug)
                # Truncate to 50 chars
                slug = slug[:50]
                # Remove trailing underscores
                slug = slug.rstrip('_')
                return slug if slug else "session"
        return "session"

    def update_session_file(self: YipsAgentProtocol) -> None:
        """Create or update the session memory file with current conversation."""
        if not hasattr(self, 'conversation_history') or not self.conversation_history:
            return

        # Create session file on first message if it doesn't exist
        first_creation = False
        if not getattr(self, 'session_created', False):
            self.session_created = True
            first_creation = True
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            # Generate meaningful name from first user message
            safe_name = self.generate_session_name_from_message()
            self.current_session_name = safe_name
            filename = f"{timestamp}_{safe_name}.md"
            self.session_file_path = MEMORIES_DIR / filename

        if not getattr(self, 'session_file_path', None):
            return

        # Ensure directory exists
        MEMORIES_DIR.mkdir(parents=True, exist_ok=True)

        # Format conversation for file
        conversation_lines: list[str] = []
        
        # Add Running Summary if it exists
        if hasattr(self, 'running_summary') and self.running_summary:
            conversation_lines.append("### Running Summary")
            conversation_lines.append(f"{self.running_summary}\n")
            conversation_lines.append("### Archived Conversation")

        # Add Archived History
        if hasattr(self, 'archived_history') and self.archived_history:
            for entry in self.archived_history:
                role = entry.get("role", "unknown")
                content = entry.get("content", "")
                if role == "user":
                    conversation_lines.append(f"**Katherine**: {content}")
                elif role == "assistant":
                    conversation_lines.append(f"**Yips**: {content}")
                elif role == "system":
                    conversation_lines.append(f"*[System: {self._format_system_preview(content, 100)}]*")
            
            conversation_lines.append("\n### Active Conversation")

        # Add Active History
        for entry in self.conversation_history:
            role = entry.get("role", "unknown")
            content = entry.get("content", "")

            if role == "user":
                conversation_lines.append(f"**Katherine**: {content}")
            elif role == "assistant":
                conversation_lines.append(f"**Yips**: {content}")
            elif role == "system":
                conversation_lines.append(f"*[System: {self._format_system_preview(content, 200)}]*")

        memory_content = f"""# Session Memory

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Type**: Ongoing Session

## Conversation

{chr(10).join(conversation_lines)}

---
*Last updated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}*"""

        try:
            if self.session_file_path:
                self.session_file_path.write_text(memory_content)
            if first_creation:
                self.refresh_title_box_only()
        except Exception:
            pass

    def rename_session(self: YipsAgentProtocol, new_name: str) -> None:
        """Rename the current session and update title box."""
        # Sanitize new name
        slug = new_name.lower().strip()
        slug = re.sub(r'[^a-z0-9_\s-]', '', slug)
        slug = re.sub(r'[\s]+', '_', slug)
        slug = slug[:50]

        if not slug:
            if hasattr(self, 'console'):
                self.console.print("[red]Invalid session name.[/red]")
            return

        self.current_session_name = slug

        # Rename file if it exists
        if getattr(self, 'session_file_path', None) and self.session_file_path and self.session_file_path.exists():
            try:
                # Expected format: YYYY-MM-DD_HH-MM-SS_slug.md
                # Split by underscore to preserve timestamp parts
                name_parts = self.session_file_path.name.split('_', 2)
                
                if len(name_parts) >= 2:
                    # Reconstruct timestamp part (first two components)
                    timestamp_part = f"{name_parts[0]}_{name_parts[1]}"
                    new_filename = f"{timestamp_part}_{slug}.md"
                    new_path = self.session_file_path.parent / new_filename
                    
                    self.session_file_path.rename(new_path)
                    self.session_file_path = new_path
                    if hasattr(self, 'console'):
                        self.console.print(f"[green]Session renamed to: {slug}[/green]")
                else:
                    # Fallback for unexpected filename format
                    new_filename = f"{slug}.md"
                    new_path = self.session_file_path.parent / new_filename
                    self.session_file_path.rename(new_path)
                    self.session_file_path = new_path
                    
            except Exception as e:
                if hasattr(self, 'console'):
                    self.console.print(f"[red]Failed to rename session file: {e}[/red]")

        self.refresh_title_box_only()

    def load_session(self: YipsAgentProtocol, file_path: Path) -> bool:
        """Load a conversation from a session memory file."""
        if not file_path.exists():
            return False

        try:
            content = file_path.read_text()
            
            # Extract conversation part
            if "## Conversation" not in content:
                return False

            conv_section = content.split("## Conversation")[-1].split("---")[0].strip()
            
            # Check for Running Summary
            self.running_summary = ""
            self.archived_history = []
            self.conversation_history = []
            
            current_section = "active" # active, archived, summary
            
            # Simple parsing state machine
            lines = conv_section.split('\n')
            
            # Re-process cleanly
            # Reset
            self.running_summary = ""
            self.archived_history = []
            self.conversation_history = []
            
            current_section = "active" # Default if no headers found
            last_list: list[Message] = self.conversation_history
            
            for line in lines:
                line = line.strip()
                if not line: continue
                
                if line == "### Running Summary":
                    current_section = "summary"
                    continue
                elif line == "### Archived Conversation":
                    current_section = "archived"
                    last_list = self.archived_history
                    continue
                elif line == "### Active Conversation":
                    current_section = "active"
                    last_list = self.conversation_history
                    continue
                
                if current_section == "summary":
                    if self.running_summary:
                        self.running_summary += "\n" + line
                    else:
                        self.running_summary = line
                else:
                    if line.startswith("**Katherine**:"):
                        last_list.append({"role": "user", "content": line[len("**Katherine**:") :].strip()})
                    elif line.startswith("**Yips**:"):
                        last_list.append({"role": "assistant", "content": line[len("**Yips**:") :].strip()})
                    elif line.startswith("*[System:"):
                        sys_content = line[9:-2].strip()
                        last_list.append({"role": "system", "content": sys_content})
                    elif last_list:
                        last_list[-1]["content"] += "\n" + line

            if self.conversation_history or self.archived_history:
                self.session_file_path = file_path
                self.session_created = True
                self.calculate_context_limits() # Recalculate limits on load
                
                # Extract session name
                name = file_path.stem
                parts = name.split('_', 2)
                if len(parts) >= 3:
                    self.current_session_name = parts[2]
                else:
                    self.current_session_name = name
                
                self.refresh_display()
                return True
                
        except Exception as e:
            if hasattr(self, 'console'):
                self.console.print(f"[red]Error loading session: {e}[/red]")
            
        return False

    def new_session(self: YipsAgentProtocol) -> None:
        """Clear current conversation and start a new session."""
        self.conversation_history = []
        self.archived_history = []
        self.running_summary = ""
        self.session_file_path = None
        self.session_created = False
        self.current_session_name = None
        
        # Recalculate limits for the new session
        self.calculate_context_limits()
        
        self.refresh_display()
