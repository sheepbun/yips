"""Tests for YipsDiscordBot._build_message_context — context field extraction."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# ---------------------------------------------------------------------------
#  Helpers to build mock discord.Message objects
# ---------------------------------------------------------------------------

def _make_text_channel(channel_id: int = 200, name: str = "general") -> MagicMock:
    import discord
    ch = MagicMock(spec=discord.TextChannel)
    ch.id = channel_id
    ch.name = name
    return ch


def _make_dm_channel(channel_id: int = 300) -> MagicMock:
    import discord
    ch = MagicMock(spec=discord.DMChannel)
    ch.id = channel_id
    # DMChannels don't always have a name attribute in the same way
    del ch.name  # remove name so getattr returns default
    return ch


def _make_thread(channel_id: int = 400, name: str = "my-thread") -> MagicMock:
    import discord
    ch = MagicMock(spec=discord.Thread)
    ch.id = channel_id
    ch.name = name
    return ch


def _make_guild(guild_id: int = 100, name: str = "TestServer") -> MagicMock:
    import discord
    g = MagicMock(spec=discord.Guild)
    g.id = guild_id
    g.name = name
    return g


def _make_author(
    user_id: int = 500,
    name: str = "alice",
    display_name: str = "Alice",
    is_bot: bool = False,
) -> MagicMock:
    import discord
    a = MagicMock(spec=discord.Member)
    a.id = user_id
    a.name = name
    a.display_name = display_name
    a.bot = is_bot
    return a


def _make_bot_user(user_id: int = 1) -> MagicMock:
    import discord
    u = MagicMock(spec=discord.ClientUser)
    u.id = user_id
    return u


def _make_message(
    message_id: int = 9999,
    channel=None,
    guild=None,
    author=None,
    mentions=None,
    reference=None,
    created_at: datetime | None = None,
) -> MagicMock:
    import discord
    msg = MagicMock(spec=discord.Message)
    msg.id = message_id
    msg.channel = channel or _make_text_channel()
    msg.guild = guild
    msg.author = author or _make_author()
    msg.mentions = mentions or []
    msg.reference = reference
    msg.created_at = created_at or datetime(2026, 3, 27, 10, 0, 0, tzinfo=timezone.utc)
    return msg


# ---------------------------------------------------------------------------
#  Import the class under test
# ---------------------------------------------------------------------------

def _get_bot_class():
    with patch("cli.gateway.discord_session.MEMORIES_DIR", MagicMock(exists=MagicMock(return_value=False))):
        with patch("discord.Client.__init__", return_value=None):
            from cli.gateway.discord_bot import YipsDiscordBot
            return YipsDiscordBot


# ---------------------------------------------------------------------------
#  Guild message context
# ---------------------------------------------------------------------------

class TestBuildMessageContextGuildMessage:
    def test_guild_context_fields(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        guild = _make_guild(100, "TestServer")
        channel = _make_text_channel(200, "general")
        author = _make_author(500, "alice", "Alice")
        message = _make_message(9999, channel=channel, guild=guild, author=author)
        bot_user = _make_bot_user(1)

        ctx = YipsDiscordBot._build_message_context(message, bot_user)

        assert ctx["source"] == "discord"
        assert ctx["message_id"] == "9999"
        assert ctx["channel_id"] == "200"
        assert ctx["channel_name"] == "general"
        assert ctx["channel_type"] == "guild_text"
        assert ctx["guild_id"] == "100"
        assert ctx["guild_name"] == "TestServer"
        assert ctx["author_id"] == "500"
        assert ctx["author_username"] == "alice"
        assert ctx["author_display_name"] == "Alice"
        assert ctx["is_bot_mentioned"] is False
        assert ctx["reply_to_message_id"] is None

    def test_timestamp_is_iso_utc(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        ts = datetime(2026, 3, 27, 12, 30, 45, tzinfo=timezone.utc)
        message = _make_message(created_at=ts)
        ctx = YipsDiscordBot._build_message_context(message, _make_bot_user())
        assert ctx["timestamp"] == "2026-03-27T12:30:45Z"


# ---------------------------------------------------------------------------
#  DM context
# ---------------------------------------------------------------------------

class TestBuildMessageContextDM:
    def test_dm_channel_type(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        channel = _make_dm_channel(300)
        message = _make_message(channel=channel, guild=None)
        ctx = YipsDiscordBot._build_message_context(message, _make_bot_user())
        assert ctx["channel_type"] == "dm"
        assert ctx["guild_id"] is None
        assert ctx["guild_name"] is None

    def test_thread_channel_type(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        channel = _make_thread(400, "my-thread")
        guild = _make_guild()
        message = _make_message(channel=channel, guild=guild)
        ctx = YipsDiscordBot._build_message_context(message, _make_bot_user())
        assert ctx["channel_type"] == "thread"


# ---------------------------------------------------------------------------
#  Bot mention detection
# ---------------------------------------------------------------------------

class TestBuildMessageContextBotMention:
    def test_bot_mentioned_true_when_in_mentions(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        bot_user = _make_bot_user(1)
        message = _make_message(mentions=[bot_user])
        ctx = YipsDiscordBot._build_message_context(message, bot_user)
        assert ctx["is_bot_mentioned"] is True

    def test_bot_mentioned_false_when_not_in_mentions(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        bot_user = _make_bot_user(1)
        other_user = _make_bot_user(999)
        message = _make_message(mentions=[other_user])
        ctx = YipsDiscordBot._build_message_context(message, bot_user)
        assert ctx["is_bot_mentioned"] is False

    def test_bot_mentioned_false_with_empty_mentions(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        bot_user = _make_bot_user(1)
        message = _make_message(mentions=[])
        ctx = YipsDiscordBot._build_message_context(message, bot_user)
        assert ctx["is_bot_mentioned"] is False


# ---------------------------------------------------------------------------
#  Reply reference
# ---------------------------------------------------------------------------

class TestBuildMessageContextReplyReference:
    def test_reply_to_message_id_extracted(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        ref = MagicMock()
        ref.message_id = 12345
        message = _make_message(reference=ref)
        ctx = YipsDiscordBot._build_message_context(message, _make_bot_user())
        assert ctx["reply_to_message_id"] == "12345"

    def test_reply_to_message_id_none_without_reference(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        message = _make_message(reference=None)
        ctx = YipsDiscordBot._build_message_context(message, _make_bot_user())
        assert ctx["reply_to_message_id"] is None

    def test_reply_to_message_id_none_when_reference_has_no_message_id(self):
        from cli.gateway.discord_bot import YipsDiscordBot
        ref = MagicMock()
        ref.message_id = None
        message = _make_message(reference=ref)
        ctx = YipsDiscordBot._build_message_context(message, _make_bot_user())
        assert ctx["reply_to_message_id"] is None
