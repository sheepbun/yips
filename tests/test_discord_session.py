"""Tests for DiscordSessionManager and Discord activity label helpers."""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import patch

from cli.gateway.discord_session import (
    DiscordSessionManager,
    build_display_label,
    infer_session_slug_from_filename,
)


def _make_manager(tmp_path: Path) -> DiscordSessionManager:
    with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
        return DiscordSessionManager()


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


class TestDisplayLabelHelpers:
    def test_builds_guild_label(self):
        assert build_display_label("Discord", "yips.dev", "general", "hello_yips") == (
            "Discord\\yips.dev\\#general | Hello Yips"
        )

    def test_builds_dm_label(self):
        assert build_display_label("Discord", "DM", "alice", "hello_yips") == (
            "Discord\\DM\\alice | Hello Yips"
        )

    def test_infers_slug_from_new_filename(self):
        path = Path("2026-03-27_12-00-00_discord_yipsdev_general_hello_yips.md")
        assert infer_session_slug_from_filename(path) == "hello_yips"


class TestAddUserMessageMetadata:
    def test_message_stored_without_metadata(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch1", "TestServer", "general")
        mgr.add_user_message("ch1", "Alice", "hello")
        history = mgr.get_history_for_runner("ch1")
        assert len(history) == 1
        assert history[0]["role"] == "user"
        assert history[0]["content"] == "Alice: hello"
        assert "metadata" not in history[0]

    def test_message_stored_with_metadata(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch1", "TestServer", "general")
        mgr.add_user_message("ch1", "Alice", "hello", metadata=_make_meta())
        history = mgr.get_history_for_runner("ch1")
        assert history[0]["metadata"]["author_id"] == "100"


class TestSaveSessionRichHeader:
    def test_first_save_uses_safe_discord_filename(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("123456", "yips.dev", "general")
            mgr.add_user_message(
                "123456",
                "Alice",
                "hello yips",
                metadata=_make_meta(channel_id="123456", guild_name="yips.dev"),
            )
            mgr.save_session("123456")

        files = list(tmp_path.glob("*_discord_*.md"))
        assert len(files) == 1
        assert re.search(r"_discord_yipsdev_general_hello_yips\.md$", files[0].name)

    def test_new_metadata_headers_present(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("123456", "yips.dev", "general")
            mgr.add_user_message(
                "123456",
                "Alice",
                "hi",
                metadata=_make_meta(channel_id="123456", guild_name="yips.dev"),
            )
            mgr.save_session("123456")

        content = list(tmp_path.glob("*.md"))[0].read_text(encoding="utf-8")
        assert "**Platform**: Discord" in content
        assert "**Server**: yips.dev" in content
        assert "**Channel**: general" in content
        assert "**Source**: Discord (#general)" in content
        assert "**ChannelId**: 123456" in content

    def test_dm_source_header_uses_non_hash_label(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("300", "DM", "Alice")
            mgr.add_user_message(
                "300",
                "Alice",
                "hello",
                metadata=_make_meta(
                    channel_id="300",
                    guild_id=None,
                    guild_name=None,
                    channel_name="Alice",
                    channel_type="dm",
                ),
            )
            mgr.save_session("300")

        content = list(tmp_path.glob("*.md"))[0].read_text(encoding="utf-8")
        assert "**Server**: DM" in content
        assert "**Channel**: Alice" in content
        assert "**Source**: Discord (Alice)" in content

    def test_rich_user_line_format(self, tmp_path: Path):
        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr.get_or_create_session("400", "TestServer", "chat")
            mgr.add_user_message(
                "400",
                "Carol",
                "greetings",
                metadata=_make_meta(author_id="777", author_display="Carol", channel_id="400"),
            )
            mgr.add_assistant_message("400", "Hello Carol!")
            mgr.save_session("400")

        content = list(tmp_path.glob("*.md"))[0].read_text(encoding="utf-8")
        assert re.search(r"\*\*Carol\*\* \[discord_user_id=777\]: greetings", content)
        assert "**Yips**: Hello Carol!" in content


class TestLoadSingleSession:
    def test_loads_new_metadata_format(self, tmp_path: Path):
        path = tmp_path / "2026-01-01_00-00-00_discord_yipsdev_general_hello.md"
        path.write_text(
            "# Session Memory\n\n"
            "**Created**: 2026-01-01 00:00:00\n"
            "**Type**: Ongoing Session\n"
            "**Source**: Discord (#general)\n"
            "**Platform**: Discord\n"
            "**Server**: yips.dev\n"
            "**Channel**: general\n"
            "**ChannelId**: 12345\n\n"
            "## Conversation\n\n"
            "**Alice** [discord_user_id=100]: hello\n"
            "**Yips**: Hi Alice!\n\n"
            "---\n*Last updated: 2026-01-01 00:00:00*\n",
            encoding="utf-8",
        )

        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        session = mgr._sessions["12345"]
        assert session.server_name == "yips.dev"
        assert session.channel_name == "general"
        assert session.session_slug == "hello"
        assert session.current_session_name == "hello"
        user_entries = [e for e in session.conversation_history if e["role"] == "user"]
        assert user_entries[0]["metadata"]["author_id"] == "100"

    def test_loads_legacy_source_with_unknown_server_fallback(self, tmp_path: Path):
        path = tmp_path / "2026-01-01_00-00-00_discord_general_greet.md"
        path.write_text(
            "# Session Memory\n\n"
            "**Created**: 2026-01-01 00:00:00\n"
            "**Type**: Ongoing Session\n"
            "**Source**: Discord (#general)\n\n"
            "## Conversation\n\n"
            "**Bob**: hey there\n"
            "**Yips**: Hello Bob!\n\n"
            "---\n*Last updated: 2026-01-01 00:00:00*\n",
            encoding="utf-8",
        )

        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)

        session = mgr._sessions["_restored_general"]
        assert session.server_name == "Unknown Server"
        assert session.channel_name == "general"

    def test_reconnect_updates_server_and_channel(self, tmp_path: Path):
        path = tmp_path / "2026-01-01_00-00-00_discord_general_greet.md"
        path.write_text(
            "# Session Memory\n\n"
            "**Created**: 2026-01-01 00:00:00\n"
            "**Type**: Ongoing Session\n"
            "**Source**: Discord (#general)\n\n"
            "## Conversation\n\n"
            "**Bob**: hey there\n"
            "---\n*Last updated: 2026-01-01 00:00:00*\n",
            encoding="utf-8",
        )

        with patch("cli.gateway.discord_session.MEMORIES_DIR", tmp_path):
            mgr = DiscordSessionManager()
            mgr._load_single_session(path)
            restored = mgr.reconnect_restored_session("777888", "yips.dev", "general")

        assert restored is not None
        assert restored.channel_id == "777888"
        assert restored.server_name == "yips.dev"
        assert "777888" in mgr._sessions


class TestGetHistoryForRunner:
    def test_returns_empty_for_unknown_channel(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        assert mgr.get_history_for_runner("nope") == []

    def test_returns_up_to_max_turns(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch", "TestServer", "test")
        for i in range(25):
            mgr.add_user_message("ch", "U", f"msg{i}")
        history = mgr.get_history_for_runner("ch", max_turns=10)
        assert len(history) == 10
        assert "msg15" in history[0]["content"]

    def test_returns_copy_not_reference(self, tmp_path: Path):
        mgr = _make_manager(tmp_path)
        mgr.get_or_create_session("ch", "TestServer", "test")
        mgr.add_user_message("ch", "U", "hello")
        history = mgr.get_history_for_runner("ch")
        history.append({"role": "user", "content": "injected"})
        assert len(mgr.get_history_for_runner("ch")) == 1
