"""Smoke tests for the Discord-related TypedDict additions in cli/type_defs.py."""

import pytest

from cli.type_defs import DiscordMessageContext, DiscordSessionEntry


class TestDiscordMessageContext:
    def test_minimal_construction(self):
        """total=False means an empty dict is valid."""
        ctx: DiscordMessageContext = {}
        assert ctx == {}

    def test_full_guild_context(self):
        ctx: DiscordMessageContext = {
            "source": "discord",
            "message_id": "111",
            "channel_id": "222",
            "channel_name": "general",
            "channel_type": "guild_text",
            "guild_id": "333",
            "guild_name": "My Server",
            "author_id": "444",
            "author_username": "alice",
            "author_display_name": "Alice",
            "is_bot_mentioned": False,
            "reply_to_message_id": None,
            "timestamp": "2026-03-27T10:00:00Z",
        }
        assert ctx["source"] == "discord"
        assert ctx["channel_type"] == "guild_text"
        assert ctx["guild_id"] == "333"
        assert ctx["is_bot_mentioned"] is False
        assert ctx["reply_to_message_id"] is None

    def test_dm_context(self):
        ctx: DiscordMessageContext = {
            "source": "discord",
            "channel_type": "dm",
            "guild_id": None,
            "guild_name": None,
            "author_id": "555",
            "author_username": "bob",
            "author_display_name": "Bob",
        }
        assert ctx["channel_type"] == "dm"
        assert ctx["guild_id"] is None

    def test_bot_mentioned_flag(self):
        ctx: DiscordMessageContext = {"is_bot_mentioned": True}
        assert ctx["is_bot_mentioned"] is True

    def test_reply_reference(self):
        ctx: DiscordMessageContext = {"reply_to_message_id": "999"}
        assert ctx["reply_to_message_id"] == "999"


class TestDiscordSessionEntry:
    def test_minimal_construction(self):
        entry: DiscordSessionEntry = {}
        assert entry == {}

    def test_user_entry_without_metadata(self):
        entry: DiscordSessionEntry = {"role": "user", "content": "Alice: hello"}
        assert entry["role"] == "user"
        assert "metadata" not in entry

    def test_user_entry_with_metadata(self):
        meta: DiscordMessageContext = {
            "source": "discord",
            "author_id": "123",
            "author_display_name": "Alice",
        }
        entry: DiscordSessionEntry = {
            "role": "user",
            "content": "Alice: hello",
            "metadata": meta,
        }
        assert entry["metadata"]["author_id"] == "123"

    def test_assistant_entry(self):
        entry: DiscordSessionEntry = {"role": "assistant", "content": "Hi there!"}
        assert entry["role"] == "assistant"

    def test_system_entry(self):
        entry: DiscordSessionEntry = {"role": "system", "content": "[Discord context]\nServer: ..."}
        assert entry["role"] == "system"
