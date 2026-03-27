"""Tests for DiscordSessionManager — metadata storage, rich markdown, dual-format load."""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import patch

import pytest

from cli.gateway.discord_session import DiscordChannelSession, DiscordSessionManager


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _make_manager(tmp_path: Path) -> DiscordSessionManager:
    with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
        mgr = DiscordSessionManager()
    return mgr


def _make_meta(
    author_id: str = "100",
    author_display: str = "Alice",
    guild_id: str = "500",
    guild_name: str = "TestServer",
    channel_id: str = "200",
    channel_name: str = "general",
    channel_type: str = "guild_text",
) -> dict:
    return {
        "source": "discord",
        "author_id": author_id,
        "author_display_name": author_display,
        "guild_id": guild_id,
        "guild_name": guild_name,
        "channel_id": channel_id,
        "channel_name": channel_name,
        "channel_type": channel_type,
        "is_bot_mentioned": False,
        "reply_to_message_id": None,
    }


# ---------------------------------------------------------------------------
#  add_user_message — metadata storage
# ---------------------------------------------------------------------------

class TestAddUserMessageMetadata:
    def test_message_stored_without_metadata(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch1", "general")
        mgr.add_user_message("ch1", "Alice", "hello")
        history = mgr.get_history_for_runner("ch1")
        assert len(history) == 1
        assert history[0]["role"] == "user"
        assert "Alice: hello" in history[0]["content"]
        assert "metadata" not in history[0]

    def test_message_stored_with_metadata(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch1", "general")
        meta = _make_meta()
        mgr.add_user_message("ch1", "Alice", "hello", metadata=meta)
        history = mgr.get_history_for_runner("ch1")
        assert history[0]["metadata"]["author_id"] == "100"

    def test_guild_id_cached_from_metadata(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch1", "general")
        meta = _make_meta(guild_id="999", guild_name="MyGuild")
        mgr.add_user_message("ch1", "Alice", "hi", metadata=meta)
        with mgr._lock:
            session = mgr._sessions["ch1"]
        assert session.guild_id == "999"
        assert session.guild_name == "MyGuild"

    def test_guild_cached_only_once(self, tmp_path: Path):
        """Second message with different guild_id should NOT overwrite the first."""
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch1", "general")
        mgr.add_user_message("ch1", "A", "first", metadata=_make_meta(guild_id="1"))
        mgr.add_user_message("ch1", "B", "second", metadata=_make_meta(guild_id="2"))
        with mgr._lock:
            session = mgr._sessions["ch1"]
        assert session.guild_id == "1"  # unchanged


# ---------------------------------------------------------------------------
#  save_session — rich markdown header
# ---------------------------------------------------------------------------

class TestSaveSessionRichHeader:
    def test_channel_id_header_present(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("123456", "general")
            mgr.add_user_message(
                "123456", "Alice", "hi", metadata=_make_meta(channel_id="123456")
            )
            mgr.save_session("123456")

        files = list(tmp_path.glob("*_discord_*.md"))
        assert len(files) == 1
        content = files[0].read_text()
        assert "**ChannelId**: 123456" in content

    def test_guild_header_present(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("200", "general")
            mgr.add_user_message(
                "200", "Alice", "hi",
                metadata=_make_meta(channel_id="200", guild_id="500", guild_name="TestServer"),
            )
            mgr.save_session("200")

        content = list(tmp_path.glob("*.md"))[0].read_text()
        assert "**Guild**: TestServer (id=500)" in content

    def test_mode_header_present(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("300", "chat")
            mgr.add_user_message(
                "300", "Bob", "hey",
                metadata=_make_meta(channel_id="300", channel_type="guild_text"),
            )
            mgr.save_session("300")

        content = list(tmp_path.glob("*.md"))[0].read_text()
        assert "**Mode**: guild_text" in content

    def test_rich_user_line_format(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("400", "chat")
            mgr.add_user_message(
                "400", "Carol", "greetings",
                metadata=_make_meta(author_id="777", author_display="Carol", channel_id="400"),
            )
            mgr.add_assistant_message("400", "Hello Carol!")
            mgr.save_session("400")

        content = list(tmp_path.glob("*.md"))[0].read_text()
        # Rich format: **Carol** [discord_user_id=777]: greetings
        assert re.search(r"\*\*Carol\*\* \[discord_user_id=777\]: greetings", content)
        assert "**Yips**: Hello Carol!" in content

    def test_legacy_user_line_without_metadata(self, tmp_path: Path):
        """Messages without metadata fall back to **Username**: text format."""
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("500", "test")
            mgr.add_user_message("500", "Dave", "plain message")
            mgr.save_session("500")

        content = list(tmp_path.glob("*.md"))[0].read_text()
        assert "**Dave**: plain message" in content


# ---------------------------------------------------------------------------
#  _load_single_session — new format (with ChannelId header)
# ---------------------------------------------------------------------------

class TestLoadSingleSessionNewFormat:
    def _write_session_file(self, tmp_path: Path, channel_id: str, channel_name: str,
                             guild_id: str, guild_name: str) -> Path:
        fname = f"2026-01-01_00-00-00_discord_{channel_name}_hello.md"
        content = (
            f"# Session Memory\n\n"
            f"**Created**: 2026-01-01 00:00:00\n"
            f"**Type**: Ongoing Session\n"
            f"**Source**: Discord\n"
            f"**Mode**: guild_text\n"
            f"**Guild**: {guild_name} (id={guild_id})\n"
            f"**Channel**: #{channel_name} (id={channel_id})\n"
            f"**ChannelId**: {channel_id}\n\n"
            f"## Conversation\n\n"
            f"**Alice** [discord_user_id=100]: hello\n"
            f"**Yips**: Hi Alice!\n\n"
            f"---\n*Last updated: 2026-01-01 00:00:00*\n"
        )
        path = tmp_path / fname
        path.write_text(content, encoding="utf-8")
        return path

    def test_loads_channel_id_directly(self, tmp_path: Path):
        path = self._write_session_file(tmp_path, "12345", "general", "99999", "MyGuild")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        # Session should be keyed by real channel_id, not synthetic
        assert "12345" in mgr._sessions
        assert "_restored_general" not in mgr._sessions

    def test_loads_guild_metadata(self, tmp_path: Path):
        path = self._write_session_file(tmp_path, "12345", "general", "99999", "MyGuild")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        session = mgr._sessions["12345"]
        assert session.guild_id == "99999"
        assert session.guild_name == "MyGuild"

    def test_loads_rich_user_lines(self, tmp_path: Path):
        path = self._write_session_file(tmp_path, "12345", "general", "99999", "MyGuild")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        session = mgr._sessions["12345"]
        user_entries = [e for e in session.conversation_history if e["role"] == "user"]
        assert len(user_entries) == 1
        assert user_entries[0]["metadata"]["author_id"] == "100"
        assert user_entries[0]["metadata"]["author_display_name"] == "Alice"

    def test_loads_assistant_lines(self, tmp_path: Path):
        path = self._write_session_file(tmp_path, "12345", "general", "99999", "MyGuild")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        session = mgr._sessions["12345"]
        asst = [e for e in session.conversation_history if e["role"] == "assistant"]
        assert len(asst) == 1
        assert asst[0]["content"] == "Hi Alice!"


# ---------------------------------------------------------------------------
#  _load_single_session — old/legacy format (no ChannelId header)
# ---------------------------------------------------------------------------

class TestLoadSingleSessionLegacyFormat:
    def _write_legacy_file(self, tmp_path: Path, channel_name: str) -> Path:
        fname = f"2026-01-01_00-00-00_discord_{channel_name}_greet.md"
        content = (
            f"# Session Memory\n\n"
            f"**Created**: 2026-01-01 00:00:00\n"
            f"**Type**: Ongoing Session\n"
            f"**Source**: Discord (#{channel_name})\n\n"
            f"## Conversation\n\n"
            f"**Bob**: hey there\n"
            f"**Yips**: Hello Bob!\n\n"
            f"---\n*Last updated: 2026-01-01 00:00:00*\n"
        )
        path = tmp_path / fname
        path.write_text(content, encoding="utf-8")
        return path

    def test_uses_synthetic_key(self, tmp_path: Path):
        path = self._write_legacy_file(tmp_path, "random")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        assert "_restored_random" in mgr._sessions
        assert f"_name_random" in mgr._sessions

    def test_history_restored(self, tmp_path: Path):
        path = self._write_legacy_file(tmp_path, "random")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        session = mgr._sessions["_restored_random"]
        assert len(session.conversation_history) == 2
        assert session.conversation_history[0]["role"] == "user"
        assert "Bob" in session.conversation_history[0]["content"]

    def test_reconnect_adopts_real_channel_id(self, tmp_path: Path):
        path = self._write_legacy_file(tmp_path, "lobby")
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)
            adopted = mgr.reconnect_restored_session("777888", "lobby")

        assert adopted is not None
        assert "777888" in mgr._sessions
        assert "_restored_lobby" not in mgr._sessions


# ---------------------------------------------------------------------------
#  get_history_for_runner — max_turns slicing
# ---------------------------------------------------------------------------

class TestGetHistoryForRunner:
    def test_returns_empty_for_unknown_channel(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        assert mgr.get_history_for_runner("nope") == []

    def test_returns_up_to_max_turns(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch", "test")
        for i in range(25):
            mgr.add_user_message("ch", "U", f"msg{i}")
        history = mgr.get_history_for_runner("ch", max_turns=10)
        assert len(history) == 10
        assert "msg15" in history[0]["content"]  # last 10 of 25

    def test_returns_copy_not_reference(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch", "test")
        mgr.add_user_message("ch", "U", "hello")
        h1 = mgr.get_history_for_runner("ch")
        h1.append({"role": "user", "content": "injected"})
        h2 = mgr.get_history_for_runner("ch")
        assert len(h2) == 1  # injection did not affect internal state
