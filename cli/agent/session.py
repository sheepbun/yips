"""
Session and memory management for YipsAgent.
"""

import re
from datetime import datetime
from pathlib import Path
from cli.config import MEMORIES_DIR


class AgentSessionMixin:
    """Mixin providing session and memory management to YipsAgent."""

    def generate_session_summary(self) -> str:
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

    def _generate_session_name_from_message(self) -> str:
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

    def update_session_file(self) -> None:
        """Create or update the session memory file with current conversation."""
        if not hasattr(self, 'conversation_history') or not self.conversation_history:
            return

        # Create session file on first message if it doesn't exist
        first_creation = False
        if not getattr(self, '_session_created', False):
            self._session_created = True
            first_creation = True
            timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            # Generate meaningful name from first user message
            safe_name = self._generate_session_name_from_message()
            self.current_session_name = safe_name
            filename = f"{timestamp}_{safe_name}.md"
            self.session_file_path = MEMORIES_DIR / filename

        if not getattr(self, 'session_file_path', None):
            return

        # Ensure directory exists
        MEMORIES_DIR.mkdir(parents=True, exist_ok=True)

        # Format conversation for file
        conversation_lines = []
        for entry in self.conversation_history:
            role = entry.get("role", "unknown")
            content = entry.get("content", "")

            if role == "user":
                conversation_lines.append(f"**Katherine**: {content}")
            elif role == "assistant":
                conversation_lines.append(f"**Yips**: {content}")
            elif role == "system":
                # Truncate long system messages
                preview = content[:200] + "..." if len(content) > 200 else content
                conversation_lines.append(f"*[System: {preview}]*")

        memory_content = f"""# Session Memory

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Type**: Ongoing Session

## Conversation

{chr(10).join(conversation_lines)}

---
*Last updated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}*"""

        try:
            self.session_file_path.write_text(memory_content)
            if first_creation:
                self.refresh_title_box_only()
        except Exception as e:
            if hasattr(self, 'console'):
                self.console.print(f"[dim]Note: Could not update session file: {e}[/dim]")

    def rename_session(self, new_name: str) -> None:
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
        if getattr(self, 'session_file_path', None) and self.session_file_path.exists():
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

    def load_session(self, file_path: Path) -> bool:
        """Load a conversation from a session memory file."""
        if not file_path.exists():
            return False

        try:
            content = file_path.read_text()
            
            # Extract conversation part
            conv_section = content.split("## Conversation")[-1].split("---")[0].strip()
            lines = conv_section.split('\n')
            
            new_history = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                if line.startswith("**Katherine**:"):
                    new_history.append({"role": "user", "content": line[len("**Katherine**:") :].strip()})
                elif line.startswith("**Yips**:"):
                    new_history.append({"role": "assistant", "content": line[len("**Yips**:") :].strip()})
                elif line.startswith("*[System:"):
                    # Remove *[System: and ]*
                    sys_content = line[9:-2].strip()
                    new_history.append({"role": "system", "content": sys_content})
                elif new_history:
                    # Append to previous message if it's a multi-line response
                    new_history[-1]["content"] += "\n" + line

            if new_history:
                self.conversation_history = new_history
                self.session_file_path = file_path
                self._session_created = True
                
                # Extract session name from filename
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

    def new_session(self) -> None:
        """Clear current conversation and start a new session."""
        self.conversation_history = []
        self.session_file_path = None
        self._session_created = False
        self.current_session_name = None
        self.refresh_display()