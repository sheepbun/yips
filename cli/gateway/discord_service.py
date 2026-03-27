"""
Background Discord bot service — runs YipsDiscordBot in a daemon thread.

start_discord_service()  starts the bot (no-op if no token or already running)
stop_discord_service()   gracefully shuts down the bot
is_discord_running()     returns whether the bot thread is alive
"""

from __future__ import annotations

import asyncio
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cli.gateway.discord_bot import YipsDiscordBot

_bot: YipsDiscordBot | None = None
_thread: threading.Thread | None = None
_loop: asyncio.AbstractEventLoop | None = None


def start_discord_service() -> None:
    """Start the Discord bot in a daemon thread.  No-op if no token or already running."""
    global _bot, _thread, _loop

    if _thread is not None and _thread.is_alive():
        return  # already running

    from cli.gateway.config import get_platform_token, get_gateway_agent

    token = get_platform_token("discord")
    if not token:
        return  # no token configured — silently skip

    # Only auto-start if a supported gateway runner is configured
    agent_key = get_gateway_agent()
    if agent_key not in ("llamacpp", "claude-code", "codex"):
        return  # no compatible runner — skip to avoid "not yet supported" errors

    from cli.gateway.discord_bot import YipsDiscordBot

    _bot = YipsDiscordBot()
    _loop = asyncio.new_event_loop()

    def _run() -> None:
        assert _bot is not None and _loop is not None
        asyncio.set_event_loop(_loop)
        try:
            _loop.run_until_complete(_bot.start(token))
        except Exception:
            pass  # token invalid, network error, etc. — don't crash the main process
        finally:
            try:
                _loop.run_until_complete(_loop.shutdown_asyncgens())
                _loop.close()
            except Exception:
                pass

    _thread = threading.Thread(target=_run, daemon=True, name="yips-discord-bot")
    _thread.start()


def stop_discord_service() -> None:
    """Gracefully close the Discord bot.  Safe to call even if not running."""
    global _bot, _thread, _loop

    if _bot is None or _loop is None:
        return

    if _loop.is_closed():
        _bot = None
        _thread = None
        _loop = None
        return

    try:
        future = asyncio.run_coroutine_threadsafe(_bot.close(), _loop)
        future.result(timeout=5)
    except Exception:
        pass  # best-effort shutdown

    _bot = None
    _thread = None
    _loop = None


def is_discord_running() -> bool:
    """Return whether the Discord bot thread is alive."""
    return _thread is not None and _thread.is_alive()


def is_discord_ready() -> bool:
    """Return whether the Discord bot has finished connecting and is ready."""
    return _bot is not None and _bot.is_ready()


def get_discord_bot_name() -> str:
    """Return the bot's display name (e.g. 'Yips#7796'), or empty string."""
    if _bot is not None and _bot.user is not None:
        return str(_bot.user)
    return ""
