"""
Discord session management for persistent per-channel conversation history.

Each Discord channel gets its own session file in .yips/memory/ using the same
markdown format as CLI sessions, with extra metadata for branded Discord labels.
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

DISCORD_PREFIX_COLOR = "#5865F2"


def _sanitize_filename_component(text: str, fallback: str) -> str:
    sanitized = re.sub(r"[^a-z0-9]+", "", text.lower())
    return sanitized or fallback


def _format_session_name(session_name: str) -> str:
    return session_name.replace("_", " ").strip().title() or "Session"


def build_display_label(
    platform_name: str,
    server_name: str,
    channel_name: str,
    session_name: str,
) -> str:
    """Build the branded Discord session label shown in CLI activity views."""
    server_label = server_name or "Unknown Server"
    channel_label = channel_name or "unknown"
    session_label = _format_session_name(session_name)

    if server_label == "DM":
        return f"{platform_name}\\DM\\{channel_label} | {session_label}"
    return f"{platform_name}\\{server_label}\\#{channel_label} | {session_label}"


def extract_display_parts(display_label: str) -> tuple[str, str]:
    """Split a branded label into prefix and title segments."""
    if " | " not in display_label:
        return "", display_label
    prefix, title = display_label.split(" | ", 1)
    return f"{prefix} | ", title


def infer_session_slug_from_filename(path: Path, channel_name: str | None = None) -> str:
    """Best-effort extraction of the user-facing session slug from a file stem."""
    stem = path.stem
    parts = stem.split("_", 2)
    suffix = parts[2] if len(parts) >= 3 else stem
    if channel_name:
        legacy_prefix = f"discord_{channel_name}_"
        if suffix.startswith(legacy_prefix):
            return suffix[len(legacy_prefix) :] or "session"
    match = re.match(r"^discord_[^_]+_[^_]+_(.+)$", suffix)
    if match:
        return match.group(1) or "session"
    return suffix


class DiscordChannelSession:
    """Tracks conversation history for a single Discord channel."""

    __slots__ = (
        "channel_id",
        "platform_name",
        "server_name",
        "channel_name",
        "session_slug",
        "conversation_history",
        "session_file_path",
        "session_created",
        "current_session_name",
    )

    def __init__(
        self,
        channel_id: str,
        server_name: str,
        channel_name: str,
        platform_name: str = "Discord",
    ) -> None:
        self.channel_id = channel_id
        self.platform_name = platform_name
        self.server_name = server_name
        self.channel_name = channel_name
        self.session_slug: str | None = None
        self.conversation_history: list[dict] = []
        self.session_file_path: Path | None = None
        self.session_created = False
        self.current_session_name: str | None = None


class DiscordSessionManager:
    """Manages all Discord channel sessions with thread-safe access."""

    def __init__(
        self,
        on_session_saved: Callable[[str, Path], None] | None = None,
    ) -> None:
        self._sessions: dict[str, DiscordChannelSession] = {}
        self._lock = threading.Lock()
        self._on_session_saved = on_session_saved

    @staticmethod
    def _sanitize_slug(text: str) -> str:
        slug = text.lower().strip()
        slug = re.sub(r"[^a-z0-9\s]", "", slug)
        slug = re.sub(r"\s+", "_", slug)
        slug = slug[:50].rstrip("_")
        return slug or "session"

    def get_or_create_session(
        self,
        channel_id: str,
        server_name: str,
        channel_name: str,
    ) -> DiscordChannelSession:
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                session = DiscordChannelSession(
                    channel_id=channel_id,
                    server_name=server_name,
                    channel_name=channel_name,
                )
                self._sessions[channel_id] = session
            else:
                session.server_name = server_name
                session.channel_name = channel_name
            return session

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
            session.conversation_history.append(entry)

    def add_assistant_message(self, channel_id: str, content: str) -> None:
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                return
            session.conversation_history.append({"role": "assistant", "content": content})

    def get_history_for_runner(
        self,
        channel_id: str,
        max_turns: int = 20,
    ) -> list[dict]:
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None:
                return []
            return list(session.conversation_history[-max_turns:])

    def save_session(self, channel_id: str) -> None:
        """Persist the channel session to a markdown file in MEMORIES_DIR."""
        session_file_path: Path | None = None
        with self._lock:
            session = self._sessions.get(channel_id)
            if session is None or not session.conversation_history:
                return

            MEMORIES_DIR.mkdir(parents=True, exist_ok=True)

            if not session.session_created:
                session.session_created = True
                timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                first_content = ""
                for msg in session.conversation_history:
                    if msg["role"] != "user":
                        continue
                    raw = msg["content"]
                    if ": " in raw:
                        raw = raw.split(": ", 1)[1]
                    first_content = raw
                    break

                slug = self._sanitize_slug(first_content) if first_content else "session"
                safe_server = _sanitize_filename_component(
                    session.server_name if session.server_name != "DM" else "dm",
                    "unknownserver",
                )
                safe_channel = _sanitize_filename_component(session.channel_name, "dm")
                session.session_slug = slug
                session.current_session_name = slug
                filename = f"{timestamp}_discord_{safe_server}_{safe_channel}_{slug}.md"
                session.session_file_path = MEMORIES_DIR / filename

            if session.session_file_path is None:
                return

            lines: list[str] = []
            for entry in session.conversation_history:
                role = entry.get("role", "unknown")
                content = entry.get("content", "")
                meta = entry.get("metadata")
                if role == "user":
                    if meta and meta.get("author_id"):
                        display = meta.get("author_display_name") or content.split(":", 1)[0]
                        text = content.split(": ", 1)[1] if ": " in content else content
                        lines.append(f"**{display}** [discord_user_id={meta['author_id']}]: {text}")
                    else:
                        name = content.split(":", 1)[0]
                        text = content.split(": ", 1)[1].strip() if ": " in content else content
                        lines.append(f"**{name}**: {text}")
                elif role == "assistant":
                    lines.append(f"**Yips**: {content}")

            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            channel_type = ""
            for entry in session.conversation_history:
                metadata = entry.get("metadata")
                if metadata and metadata.get("channel_type"):
                    channel_type = metadata["channel_type"]
                    break

            source_suffix = (
                f"({session.channel_name})" if session.server_name == "DM" else f"(#{session.channel_name})"
            )
            header_lines = [
                "# Session Memory",
                "",
                f"**Created**: {now}",
                "**Type**: Ongoing Session",
                f"**Source**: Discord {source_suffix}",
                f"**Platform**: {session.platform_name}",
                f"**Server**: {session.server_name}",
                f"**Channel**: {session.channel_name}",
                f"**ChannelId**: {session.channel_id}",
            ]
            if channel_type:
                header_lines.append(f"**Mode**: {channel_type}")
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
        with self._lock:
            self._sessions.pop(channel_id, None)

    def load_sessions_from_disk(self) -> None:
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

        platform_name = "Discord"
        server_name = "Unknown Server"
        channel_name = "unknown"
        channel_id_from_header: str | None = None

        for line in content.splitlines():
            if line.startswith("**Platform**:"):
                platform_name = line.split(":", 1)[1].strip() or "Discord"
            elif line.startswith("**Server**:"):
                server_name = line.split(":", 1)[1].strip() or "Unknown Server"
            elif line.startswith("**Channel**:"):
                channel_name = line.split(":", 1)[1].strip() or "unknown"
            elif line.startswith("**ChannelId**:"):
                channel_id_from_header = line.split(":", 1)[1].strip() or None
            elif line.startswith("**Source**: Discord"):
                if server_name == "Unknown Server":
                    server_name = "Unknown Server"
                if channel_name == "unknown":
                    guild_match = re.search(r"\(#(.+?)\)", line)
                    dm_match = re.search(r"\((?!#)(.+?)\)", line)
                    if guild_match:
                        channel_name = guild_match.group(1)
                    elif dm_match:
                        server_name = "DM"
                        channel_name = dm_match.group(1)

        conv_section = content.split("## Conversation", 1)[-1].split("---", 1)[0].strip()
        history: list[dict] = []

        for raw_line in conv_section.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("**Yips**:"):
                history.append({"role": "assistant", "content": line[len("**Yips**:") :].strip()})
            elif line.startswith("**"):
                rich_match = re.match(r"\*\*(.+?)\*\*\s+\[discord_user_id=(\d+)\]:\s*(.*)", line)
                if rich_match:
                    display_name, user_id, msg = rich_match.groups()
                    history.append(
                        {
                            "role": "user",
                            "content": f"{display_name}: {msg}",
                            "metadata": {
                                "source": "discord",
                                "author_id": user_id,
                                "author_display_name": display_name,
                            },
                        }
                    )
                else:
                    legacy_match = re.match(r"\*\*(.+?)\*\*:\s*(.*)", line)
                    if legacy_match:
                        username, msg = legacy_match.groups()
                        history.append({"role": "user", "content": f"{username}: {msg}"})
            elif history:
                history[-1]["content"] += "\n" + line

        if not history:
            return

        session_slug = infer_session_slug_from_filename(path, channel_name=channel_name)

        if channel_id_from_header:
            session = DiscordChannelSession(
                channel_id=channel_id_from_header,
                platform_name=platform_name,
                server_name=server_name,
                channel_name=channel_name,
            )
            session.session_slug = session_slug
            session.current_session_name = session_slug
            session.conversation_history = history
            session.session_file_path = path
            session.session_created = True

            with self._lock:
                self._sessions[channel_id_from_header] = session
        else:
            synthetic_key = f"_restored_{channel_name}"
            session = DiscordChannelSession(
                channel_id=synthetic_key,
                platform_name=platform_name,
                server_name=server_name,
                channel_name=channel_name,
            )
            session.session_slug = session_slug
            session.current_session_name = session_slug
            session.conversation_history = history
            session.session_file_path = path
            session.session_created = True

            with self._lock:
                self._sessions[synthetic_key] = session
                self._sessions[f"_name_{channel_name}"] = session

    def reconnect_restored_session(
        self,
        channel_id: str,
        server_name: str,
        channel_name: str,
    ) -> DiscordChannelSession | None:
        with self._lock:
            hint_key = f"_name_{channel_name}"
            restored = self._sessions.get(hint_key)
            if restored is None:
                return None

            old_key = restored.channel_id
            restored.channel_id = channel_id
            restored.server_name = server_name
            restored.channel_name = channel_name
            self._sessions[channel_id] = restored
            self._sessions.pop(old_key, None)
            self._sessions.pop(hint_key, None)
            return restored
