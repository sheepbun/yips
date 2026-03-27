"""
Discord session management — persistent per-channel conversation history.

Each Discord channel gets its own session, stored in .yips/memory/ using the
same markdown format as CLI sessions.  This allows Discord conversations to
appear in the CLI's /sessions listing and be resumed across restarts.
"""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable

from cli.config import MEMORIES_DIR

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
#  Per-channel session state
# ---------------------------------------------------------------------------

class DiscordChannelSession:
    """Tracks conversation history for a single Discord channel."""

    __slots__ = (
        "channel_id",
        "channel_name",
        "conversation_history",
        "session_file_path",
        "session_created",
        "current_session_name",
        "guild_id",
        "guild_name",
    )

    def __init__(self, channel_id: str, channel_name: str) -> None:
        self.channel_id = channel_id
        self.channel_name = channel_name
        self.conversation_history: list[dict] = []
        self.session_file_path: Path | None = None
        self.session_created: bool = False
        self.current_session_name: str | None = None
        self.guild_id: str | None = None
        self.guild_name: str | None = None


# ---------------------------------------------------------------------------
#  Session manager (one per bot)
# ---------------------------------------------------------------------------

class DiscordSessionManager:
    """Manages all Discord channel sessions with thread-safe access."""

    def __init__(
        self,
        on_session_saved: Callable[[str, Path], None] | None = None,
    ) -> None:
        self._sessions: dict[str, DiscordChannelSession] = {}
        self._lock = threading.Lock()
        self._on_session_saved = on_session_saved

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _sanitize_slug(text: str) -> str:
        """Convert arbitrary text into a safe filename slug (replicated from
        AgentSessionMixin.generate_session_name_from_message)."""
        slug = text.lower().strip()
        slug = re.sub(r"[^a-z0-9\s]", "", slug)
        slug = re.sub(r"\s+", "_", slug)
        slug = slug[:50].rstrip("_")
        return slug or "session"

    # -- public API --------------------------------------------------------

    def get_or_create_session(
        self, channel_id: str, channel_name: str
    ) -> DiscordChannelSession:
        with self._lock:
            if channel_id not in self._sessions:
                self._sessions[channel_id] = DiscordChannelSession(
                    channel_id, channel_name
                )
            return self._sessions[channel_id]

    def add_user_message(
        self,
        channel_id: str,
        username: str,
        content: str,
        metadata: dict | None = None,
    ) -> None:
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                return
            entry: dict = {"role": "user", "content": f"{username}: {content}"}
            if metadata is not None:
                entry["metadata"] = metadata
                # Opportunistically cache guild identity from the first message that has it
                if session.guild_id is None and metadata.get("guild_id"):
                    session.guild_id = metadata["guild_id"]
                if session.guild_name is None and metadata.get("guild_name"):
                    session.guild_name = metadata["guild_name"]
            session.conversation_history.append(entry)

    def add_assistant_message(self, channel_id: str, content: str) -> None:
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                return
            session.conversation_history.append(
                {"role": "assistant", "content": content}
            )

    def get_history_for_runner(
        self, channel_id: str, max_turns: int = 20
    ) -> list[dict]:
        """Return the last *max_turns* messages suitable for passing to a runner."""
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                return []
            # Slice a copy so the runner can't mutate our state
            return list(session.conversation_history[-max_turns:])

    def save_session(self, channel_id: str) -> None:
        """Persist the channel session to a markdown file in MEMORIES_DIR."""
        session_file_path: Path | None = None
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None or not session.conversation_history:
                return

            MEMORIES_DIR.mkdir(parents=True, exist_ok=True)

            # Create file on first save
            if not session.session_created:
                session.session_created = True
                timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                # Derive name from first user message content
                first_content = ""
                for msg in session.conversation_history:
                    if msg["role"] == "user":
                        # Strip "Username: " prefix for slug generation
                        raw = msg["content"]
                        if ": " in raw:
                            raw = raw.split(": ", 1)[1]
                        first_content = raw
                        break
                slug = self._sanitize_slug(first_content) if first_content else "session"
                safe_channel = re.sub(r"[^a-z0-9_]", "", session.channel_name.lower()) or "dm"
                session.current_session_name = f"discord_{safe_channel}_{slug}"
                filename = f"{timestamp}_{session.current_session_name}.md"
                session.session_file_path = MEMORIES_DIR / filename

            if session.session_file_path is None:
                return

            # Build markdown (same structure as CLI's update_session_file)
            lines: list[str] = []
            for entry in session.conversation_history:
                role = entry.get("role", "unknown")
                content = entry.get("content", "")
                meta = entry.get("metadata")
                if role == "user":
                    if meta and meta.get("author_id"):
                        # Rich format: **DisplayName** [discord_user_id=123]: text
                        display = meta.get("author_display_name") or content.split(":", 1)[0]
                        text = content.split(": ", 1)[1] if ": " in content else content
                        lines.append(f"**{display}** [discord_user_id={meta['author_id']}]: {text}")
                    else:
                        # Legacy format
                        name = content.split(":", 1)[0]
                        text = content.split(": ", 1)[1].strip() if ": " in content else content
                        lines.append(f"**{name}**: {text}")
                elif role == "assistant":
                    lines.append(f"**Yips**: {content}")

            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            channel_type = ""
            # Determine channel type from the first message that has metadata
            for entry in session.conversation_history:
                m = entry.get("metadata")
                if m and m.get("channel_type"):
                    channel_type = m["channel_type"]
                    break

            header_lines = [
                "# Session Memory",
                "",
                f"**Created**: {now}",
                "**Type**: Ongoing Session",
                f"**Source**: Discord",
            ]
            if channel_type:
                header_lines.append(f"**Mode**: {channel_type}")
            if session.guild_name or session.guild_id:
                guild_str = session.guild_name or ""
                if session.guild_id:
                    guild_str += f" (id={session.guild_id})"
                header_lines.append(f"**Guild**: {guild_str.strip()}")
            header_lines.append(f"**Channel**: #{session.channel_name} (id={session.channel_id})")
            header_lines.append(f"**ChannelId**: {session.channel_id}")
            header_lines.append("")

            md = (
                "\n".join(header_lines)
                + "\n## Conversation\n\n"
                + "\n".join(lines)
                + f"\n\n---\n*Last updated: {now}*"
            )

            try:
                session.session_file_path.write_text(md, encoding="utf-8")
                session_file_path = session.session_file_path
            except Exception as exc:
                log.debug("Failed to save Discord session: %s", exc, exc_info=True)
                return

        if session_file_path is not None and self._on_session_saved is not None:
            try:
                self._on_session_saved(channel_id, session_file_path)
            except Exception as exc:
                log.debug("Discord session save callback failed: %s", exc, exc_info=True)

    def reset_session(self, channel_id: str) -> None:
        """Clear a channel's session so the next message starts fresh."""
        with self._lock:
            if channel_id in self._sessions:
                del self._sessions[channel_id]

    # -- startup -----------------------------------------------------------

    def load_sessions_from_disk(self) -> None:
        """Scan MEMORIES_DIR for ``*_discord_*`` files and restore sessions.

        This is a best-effort loader — it re-creates in-memory sessions so
        that a bot restart preserves conversation context.
        """
        if not MEMORIES_DIR.exists():
            return

        for path in sorted(MEMORIES_DIR.glob("*_discord_*.md")):
            try:
                self._load_single_session(path)
            except Exception as exc:
                log.warning("Skipping session file %s: %s", path.name, exc)

    def _load_single_session(self, path: Path) -> None:
        content = path.read_text(encoding="utf-8", errors="replace")
        if "## Conversation" not in content:
            return

        # ------------------------------------------------------------------
        # Parse header fields
        # ------------------------------------------------------------------
        channel_name = "unknown"
        channel_id_from_header: str | None = None
        guild_id_from_header: str | None = None
        guild_name_from_header: str | None = None

        for line in content.splitlines():
            if line.startswith("**Source**: Discord"):
                # Legacy format: **Source**: Discord (#channel-name)
                m = re.search(r"\(#(.+?)\)", line)
                if m:
                    channel_name = m.group(1)
            elif line.startswith("**Channel**:"):
                # New format: **Channel**: #channel-name (id=123456)
                m = re.search(r"#([^\s(]+)", line)
                if m:
                    channel_name = m.group(1)
            elif line.startswith("**ChannelId**:"):
                # New format: **ChannelId**: 123456789
                m = re.search(r"\*\*ChannelId\*\*:\s*(\d+)", line)
                if m:
                    channel_id_from_header = m.group(1)
            elif line.startswith("**Guild**:"):
                # New format: **Guild**: My Server (id=123456789)
                m = re.search(r"\*\*Guild\*\*:\s*(.+?)\s*\(id=(\d+)\)", line)
                if m:
                    guild_name_from_header = m.group(1).strip()
                    guild_id_from_header = m.group(2)
                else:
                    # Name without id
                    m2 = re.search(r"\*\*Guild\*\*:\s*(.+)", line)
                    if m2:
                        guild_name_from_header = m2.group(1).strip()

        # ------------------------------------------------------------------
        # Parse conversation section
        # ------------------------------------------------------------------
        conv_section = content.split("## Conversation")[-1].split("---")[0].strip()
        history: list[dict] = []

        for line in conv_section.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("**Yips**:"):
                history.append({"role": "assistant", "content": line[len("**Yips**:"):].strip()})
            elif line.startswith("**"):
                # Try new rich format: **DisplayName** [discord_user_id=123]: text
                m = re.match(r"\*\*(.+?)\*\*\s+\[discord_user_id=(\d+)\]:\s*(.*)", line)
                if m:
                    display_name, user_id, msg = m.group(1), m.group(2), m.group(3)
                    entry: dict = {
                        "role": "user",
                        "content": f"{display_name}: {msg}",
                        "metadata": {
                            "source": "discord",
                            "author_id": user_id,
                            "author_display_name": display_name,
                        },
                    }
                    history.append(entry)
                else:
                    # Legacy format: **Username**: content
                    m2 = re.match(r"\*\*(.+?)\*\*:\s*(.*)", line)
                    if m2:
                        username, msg = m2.group(1), m2.group(2)
                        history.append({"role": "user", "content": f"{username}: {msg}"})
            elif history:
                # Continuation of previous message
                history[-1]["content"] += "\n" + line

        if not history:
            return

        # ------------------------------------------------------------------
        # Build session object
        # ------------------------------------------------------------------
        if channel_id_from_header:
            # New format: use real channel_id directly (no synthetic key needed)
            session = DiscordChannelSession(
                channel_id=channel_id_from_header,
                channel_name=channel_name,
            )
            session.guild_id = guild_id_from_header
            session.guild_name = guild_name_from_header
            session.conversation_history = history
            session.session_file_path = path
            session.session_created = True

            stem = path.stem
            parts = stem.split("_", 2)
            session.current_session_name = parts[2] if len(parts) >= 3 else stem

            with self._lock:
                self._sessions[channel_id_from_header] = session
                log.debug(
                    "Restored Discord session for #%s (id=%s, %d messages)",
                    channel_name, channel_id_from_header, len(history),
                )
        else:
            # Legacy format: use synthetic key + reconnect_restored_session approach
            session = DiscordChannelSession(
                channel_id=f"_restored_{channel_name}",
                channel_name=channel_name,
            )
            session.guild_id = guild_id_from_header
            session.guild_name = guild_name_from_header
            session.conversation_history = history
            session.session_file_path = path
            session.session_created = True

            stem = path.stem
            parts = stem.split("_", 2)
            session.current_session_name = parts[2] if len(parts) >= 3 else stem

            with self._lock:
                self._sessions[session.channel_id] = session
                # Also store a mapping hint so we can reconnect on first message
                self._sessions[f"_name_{channel_name}"] = session
                log.debug(
                    "Restored Discord session for #%s (%d messages)", channel_name, len(history)
                )

    def reconnect_restored_session(
        self, channel_id: str, channel_name: str
    ) -> DiscordChannelSession | None:
        """If a restored-from-disk session matches this channel name, adopt it
        under the real channel_id and return it.  Otherwise return None."""
        with self._lock:
            hint_key = f"_name_{channel_name}"
            restored = self._sessions.get(hint_key)
            if restored is None:
                return None

            # Move from synthetic key to real channel_id
            old_key = restored.channel_id
            restored.channel_id = channel_id
            restored.channel_name = channel_name
            self._sessions[channel_id] = restored

            # Clean up synthetic keys
            self._sessions.pop(old_key, None)
            self._sessions.pop(hint_key, None)
            return restored
