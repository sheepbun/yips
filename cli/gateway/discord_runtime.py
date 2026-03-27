"""
Read-only Discord data access layer.

Provides synchronous helpers that run coroutines in the Discord bot's event
loop via asyncio.run_coroutine_threadsafe.  All functions return plain dicts
so callers never need to import discord.py types.

Import pattern for callers
--------------------------
To avoid circular imports (tools → runtime → service → bot → tools), always
import this module lazily inside the function body::

    def _execute_discord_tool(...):
        from cli.gateway import discord_runtime
        return discord_runtime.get_guild(guild_id)
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass  # discord imported lazily below to keep this module lightweight

_TIMEOUT = 10.0  # seconds to wait for a coroutine result


# ---------------------------------------------------------------------------
#  Internal helpers
# ---------------------------------------------------------------------------

def _get_bot_and_loop():  # type: ignore[return]
    """Return (bot, loop) or raise RuntimeError if the bot is not running."""
    from cli.gateway import discord_service
    bot = discord_service.get_discord_bot()
    loop = discord_service.get_discord_loop()
    if bot is None or loop is None or loop.is_closed():
        raise RuntimeError("Discord bot is not running.")
    return bot, loop


def _run(coro: "asyncio.Coroutine[Any, Any, Any]", loop: asyncio.AbstractEventLoop) -> Any:
    """Submit *coro* to *loop* from a non-async thread and block for the result."""
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=_TIMEOUT)


def _guild_to_dict(guild: Any) -> dict:
    return {
        "id": str(guild.id),
        "name": guild.name,
        "member_count": getattr(guild, "member_count", None),
        "description": getattr(guild, "description", None),
    }


def _member_to_dict(member: Any) -> dict:
    return {
        "id": str(member.id),
        "username": member.name,
        "display_name": member.display_name,
        "discriminator": getattr(member, "discriminator", "0"),
        "bot": member.bot,
        "roles": [str(r.id) for r in getattr(member, "roles", []) if r.name != "@everyone"],
    }


def _channel_to_dict(channel: Any) -> dict:
    return {
        "id": str(channel.id),
        "name": getattr(channel, "name", ""),
        "type": type(channel).__name__,
        "position": getattr(channel, "position", None),
        "topic": getattr(channel, "topic", None),
        "category": getattr(getattr(channel, "category", None), "name", None),
    }


def _role_to_dict(role: Any) -> dict:
    return {
        "id": str(role.id),
        "name": role.name,
        "color": str(role.color),
        "hoist": role.hoist,
        "position": role.position,
        "mentionable": role.mentionable,
        "managed": role.managed,
    }


# ---------------------------------------------------------------------------
#  Public API
# ---------------------------------------------------------------------------

def get_guild(guild_id: str) -> dict | None:
    """Return a plain-dict summary of the guild, or None if bot is not running
    or the guild is not found."""
    from cli.gateway import discord_service
    bot = discord_service.get_discord_bot()
    if bot is None:
        return None

    import discord  # noqa: PLC0415
    guild = bot.get_guild(int(guild_id))
    if guild is None:
        return None
    return _guild_to_dict(guild)


def list_members(
    guild_id: str,
    query: str | None = None,
    limit: int = 25,
) -> list[dict]:
    """Return up to *limit* member dicts for the guild.

    Raises
    ------
    RuntimeError
        If the bot is not running or the members privileged intent is not
        enabled.
    """
    bot, loop = _get_bot_and_loop()

    import discord  # noqa: PLC0415

    if not bot.intents.members:
        raise RuntimeError(
            "The 'members' privileged intent is not enabled.  "
            "Enable it in the Discord Developer Portal and set "
            "intents.members = True in the bot constructor."
        )

    guild = bot.get_guild(int(guild_id))
    if guild is None:
        return []

    async def _fetch() -> list[dict]:
        results: list[dict] = []
        async for member in guild.fetch_members(limit=limit):
            if query:
                q = query.lower()
                if q not in member.name.lower() and q not in member.display_name.lower():
                    continue
            results.append(_member_to_dict(member))
            if len(results) >= limit:
                break
        return results

    return _run(_fetch(), loop)


def get_member(guild_id: str, identifier: str) -> dict | None:
    """Look up a single member by ID (exact) or display_name/username (substring).

    Returns None if not found.

    Raises
    ------
    RuntimeError
        If the bot is not running or the members intent is not enabled.
    """
    bot, loop = _get_bot_and_loop()

    if not bot.intents.members:
        raise RuntimeError(
            "The 'members' privileged intent is not enabled.  "
            "Enable it in the Discord Developer Portal and set "
            "intents.members = True in the bot constructor."
        )

    guild = bot.get_guild(int(guild_id))
    if guild is None:
        return None

    # Try exact ID match first (fast path, no API call needed)
    try:
        member_id = int(identifier)
        member = guild.get_member(member_id)
        if member is not None:
            return _member_to_dict(member)
    except ValueError:
        pass

    # Fall back to substring name search via fetch_members
    async def _fetch() -> dict | None:
        q = identifier.lower()
        async for member in guild.fetch_members(limit=1000):
            if q in member.name.lower() or q in member.display_name.lower():
                return _member_to_dict(member)
        return None

    return _run(_fetch(), loop)


def list_channels(guild_id: str) -> list[dict]:
    """Return all channels in the guild as plain dicts.

    Raises
    ------
    RuntimeError
        If the bot is not running.
    """
    bot, _ = _get_bot_and_loop()

    guild = bot.get_guild(int(guild_id))
    if guild is None:
        return []
    return [_channel_to_dict(c) for c in guild.channels]


def list_roles(guild_id: str) -> list[dict]:
    """Return all roles in the guild as plain dicts.

    Raises
    ------
    RuntimeError
        If the bot is not running.
    """
    bot, _ = _get_bot_and_loop()

    guild = bot.get_guild(int(guild_id))
    if guild is None:
        return []
    return [_role_to_dict(r) for r in guild.roles]
