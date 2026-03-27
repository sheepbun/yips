"""Tests for Discord tool schemas and execute_gateway_tool dispatch."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from cli.gateway.tools import (
    GATEWAY_TOOLS_DISCORD_READ_ONLY,
    execute_gateway_tool,
)


# ---------------------------------------------------------------------------
#  Tool schema sanity
# ---------------------------------------------------------------------------

class TestDiscordToolSchemas:
    def test_all_six_tools_present(self):
        names = {t["function"]["name"] for t in GATEWAY_TOOLS_DISCORD_READ_ONLY}
        assert names == {
            "discord_get_server_context",
            "discord_list_members",
            "discord_get_member",
            "discord_list_channels",
            "discord_list_roles",
            "discord_format_mention",
        }

    def test_all_tools_have_type_function(self):
        for t in GATEWAY_TOOLS_DISCORD_READ_ONLY:
            assert t["type"] == "function"

    def test_discord_get_member_requires_identifier(self):
        schema = next(
            t for t in GATEWAY_TOOLS_DISCORD_READ_ONLY
            if t["function"]["name"] == "discord_get_member"
        )
        assert "identifier" in schema["function"]["parameters"]["required"]

    def test_discord_list_members_has_optional_params(self):
        schema = next(
            t for t in GATEWAY_TOOLS_DISCORD_READ_ONLY
            if t["function"]["name"] == "discord_list_members"
        )
        props = schema["function"]["parameters"]["properties"]
        assert "query" in props
        assert "limit" in props
        # Neither is required
        assert schema["function"]["parameters"].get("required", []) == []


# ---------------------------------------------------------------------------
#  execute_gateway_tool — Discord tools blocked without context
# ---------------------------------------------------------------------------

class TestDiscordFormatMention:
    def test_returns_mention_tag(self):
        ctx = {"guild_id": "1", "channel_id": "2", "author_id": "3"}
        result = execute_gateway_tool(
            "discord_format_mention", {"user_id": "255176556945735683"},
            can_edit=False, message_context=ctx,
        )
        assert result == "<@255176556945735683>"

    def test_missing_user_id_returns_error(self):
        ctx = {"guild_id": "1", "channel_id": "2", "author_id": "3"}
        result = execute_gateway_tool(
            "discord_format_mention", {},
            can_edit=False, message_context=ctx,
        )
        assert result.startswith("Error:")

    def test_blocked_without_context(self):
        result = execute_gateway_tool(
            "discord_format_mention", {"user_id": "123"},
            can_edit=False, message_context=None,
        )
        assert result.startswith("Error:")

    def test_dm_context_guild_id_none_returns_error(self):
        ctx = {"channel_id": "2", "author_id": "3"}  # no guild_id
        result = execute_gateway_tool(
            "discord_format_mention", {"user_id": "123"},
            can_edit=False, message_context=ctx,
        )
        assert result.startswith("Error:")


class TestDiscordToolsBlockedWithoutContext:
    @pytest.mark.parametrize("tool_name", [
        "discord_get_server_context",
        "discord_list_members",
        "discord_get_member",
        "discord_list_channels",
        "discord_list_roles",
        "discord_format_mention",
    ])
    def test_blocked_without_context(self, tool_name: str):
        result = execute_gateway_tool(tool_name, {}, can_edit=False, message_context=None)
        assert result.startswith("Error:")
        assert "only available in Discord" in result

    @pytest.mark.parametrize("tool_name", [
        "discord_get_server_context",
        "discord_list_channels",
        "discord_list_roles",
    ])
    def test_allowed_with_context(self, tool_name: str):
        """With message_context the tool is dispatched (not blocked at the gate)."""
        ctx = {"guild_id": "123", "channel_id": "456", "author_id": "789"}
        with patch("cli.gateway.discord_runtime.get_guild") as mock_get, \
             patch("cli.gateway.discord_runtime.list_channels") as mock_ch, \
             patch("cli.gateway.discord_runtime.list_roles") as mock_ro:
            mock_get.return_value = {"id": "123", "name": "SRV"}
            mock_ch.return_value = []
            mock_ro.return_value = []
            result = execute_gateway_tool(tool_name, {}, can_edit=False, message_context=ctx)
        # Should NOT start with a "blocked" error
        assert "only available in Discord" not in result


# ---------------------------------------------------------------------------
#  execute_gateway_tool — DM context returns graceful error
# ---------------------------------------------------------------------------

class TestDiscordToolsInDMs:
    @pytest.mark.parametrize("tool_name", [
        "discord_get_server_context",
        "discord_list_members",
        "discord_get_member",
        "discord_list_channels",
        "discord_list_roles",
    ])
    def test_dm_returns_graceful_error(self, tool_name: str):
        # DM context: guild_id is absent (or None)
        ctx = {"channel_id": "999", "channel_type": "dm", "author_id": "1"}
        result = execute_gateway_tool(tool_name, {}, can_edit=False, message_context=ctx)
        assert result.startswith("Error:")
        assert "direct message" in result.lower() or "DM" in result


# ---------------------------------------------------------------------------
#  execute_gateway_tool — discord_get_member requires identifier
# ---------------------------------------------------------------------------

class TestDiscordGetMemberRequiresIdentifier:
    def test_empty_identifier_returns_error(self):
        ctx = {"guild_id": "123", "channel_id": "456", "author_id": "789"}
        result = execute_gateway_tool(
            "discord_get_member", {"identifier": ""}, can_edit=False, message_context=ctx
        )
        assert result.startswith("Error:")
        assert "identifier" in result.lower()

    def test_missing_identifier_returns_error(self):
        ctx = {"guild_id": "123", "channel_id": "456", "author_id": "789"}
        result = execute_gateway_tool(
            "discord_get_member", {}, can_edit=False, message_context=ctx
        )
        assert result.startswith("Error:")


# ---------------------------------------------------------------------------
#  execute_gateway_tool — discord_list_members no-intent raises RuntimeError
# ---------------------------------------------------------------------------

class TestDiscordListMembersNoIntent:
    def test_no_intent_returns_error_string(self):
        ctx = {"guild_id": "123", "channel_id": "456", "author_id": "789"}
        with patch(
            "cli.gateway.discord_runtime.list_members",
            side_effect=RuntimeError("The 'members' privileged intent is not enabled."),
        ):
            result = execute_gateway_tool(
                "discord_list_members", {}, can_edit=False, message_context=ctx
            )
        assert result.startswith("Error:")
        assert "intent" in result.lower()


# ---------------------------------------------------------------------------
#  execute_gateway_tool — discord_get_server_context guild not found
# ---------------------------------------------------------------------------

class TestDiscordGetServerContextGuildNotFound:
    def test_none_guild_returns_error(self):
        ctx = {"guild_id": "000", "channel_id": "1", "author_id": "2"}
        with patch("cli.gateway.discord_runtime.get_guild", return_value=None):
            result = execute_gateway_tool(
                "discord_get_server_context", {}, can_edit=False, message_context=ctx
            )
        assert result.startswith("Error:")

    def test_found_guild_returns_json(self):
        ctx = {"guild_id": "123", "channel_id": "1", "author_id": "2"}
        guild_data = {"id": "123", "name": "SRV", "member_count": 10}
        with patch("cli.gateway.discord_runtime.get_guild", return_value=guild_data):
            result = execute_gateway_tool(
                "discord_get_server_context", {}, can_edit=False, message_context=ctx
            )
        parsed = json.loads(result)
        assert parsed["name"] == "SRV"


# ---------------------------------------------------------------------------
#  execute_gateway_tool — limit clamping for discord_list_members
# ---------------------------------------------------------------------------

class TestDiscordListMembersLimitClamping:
    def test_limit_clamped_to_100(self):
        ctx = {"guild_id": "1", "channel_id": "2", "author_id": "3"}
        captured_limit: list[int] = []

        def fake_list_members(guild_id, query=None, limit=25):
            captured_limit.append(limit)
            return []

        with patch("cli.gateway.discord_runtime.list_members", side_effect=fake_list_members):
            execute_gateway_tool(
                "discord_list_members",
                {"limit": 9999},
                can_edit=False,
                message_context=ctx,
            )

        assert captured_limit[0] == 100

    def test_limit_minimum_1(self):
        ctx = {"guild_id": "1", "channel_id": "2", "author_id": "3"}
        captured_limit: list[int] = []

        def fake_list_members(guild_id, query=None, limit=25):
            captured_limit.append(limit)
            return []

        with patch("cli.gateway.discord_runtime.list_members", side_effect=fake_list_members):
            execute_gateway_tool(
                "discord_list_members",
                {"limit": -5},
                can_edit=False,
                message_context=ctx,
            )

        assert captured_limit[0] == 1
