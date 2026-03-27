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
    )

    def __init__(self, channel_id: str, channel_name: str) -> None:
        self.channel_id = channel_id
        self.channel_name = channel_name
        self.conversation_history: list[dict] = []
        self.session_file_path: Path | None = None
        self.session_created: bool = False
        self.current_session_name: str | None = None


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
        self, channel_id: str, username: str, content: str
    ) -> None:
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                return
            session.conversation_history.append(
                {"role": "user", "content": f"{username}: {content}"}
            )

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
                if role == "user":
                    lines.append(f"**{content.split(':', 1)[0]}**: {content.split(':', 1)[1].strip() if ':' in content else content}")
                elif role == "assistant":
                    lines.append(f"**Yips**: {content}")

            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            md = (
                f"# Session Memory\n\n"
                f"**Created**: {now}\n"
                f"**Type**: Ongoing Session\n"
                f"**Source**: Discord (#{session.channel_name})\n\n"
                f"## Conversation\n\n"
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

        # Extract channel name from Source line
        channel_name = "unknown"
        for line in content.splitlines():
            if line.startswith("**Source**: Discord"):
                m = re.search(r"\(#(.+?)\)", line)
                if m:
                    channel_name = m.group(1)
                break

        conv_section = content.split("## Conversation")[-1].split("---")[0].strip()
        history: list[dict] = []

        for line in conv_section.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("**Yips**:"):
                history.append({"role": "assistant", "content": line[len("**Yips**:"):].strip()})
            elif line.startswith("**"):
                # User message: **Username**: content
                m = re.match(r"\*\*(.+?)\*\*:\s*(.*)", line)
                if m:
                    username, msg = m.group(1), m.group(2)
                    history.append({"role": "user", "content": f"{username}: {msg}"})
            elif history:
                # Continuation of previous message
                history[-1]["content"] += "\n" + line

        if not history:
            return

        # We don't know the original channel_id, so we key by channel_name
        # to at least avoid duplicates; the real channel_id will be set on
        # the next incoming Discord message that matches.
        # Use a synthetic key — actual reconnection happens via channel_name matching.
        session = DiscordChannelSession(
            channel_id=f"_restored_{channel_name}",
            channel_name=channel_name,
        )
        session.conversation_history = history
        session.session_file_path = path
        session.session_created = True

        # Extract session name from filename (timestamp_discord_channel_slug.md)
        stem = path.stem
        parts = stem.split("_", 2)
        session.current_session_name = parts[2] if len(parts) >= 3 else stem

        with self._lock:
            self._sessions[session.channel_id] = session
            # Also store a mapping hint so we can reconnect on first message
            self._sessions[f"_name_{channel_name}"] = session
            log.debug("Restored Discord session for #%s (%d messages)", channel_name, len(history))

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
