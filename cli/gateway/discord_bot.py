"""
Yips Discord Bot — connects to Discord and routes messages through the configured AgentRunner.

Usage:
    /discord start   (from the Yips CLI)

Requirements:
    - Discord bot token set via /gateway
    - message_content privileged intent enabled in Discord Developer Portal
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import discord

from cli.gateway.config import (
    get_agent_bin_path,
    get_agent_api_key,
    get_discord_allowed_channels,
    get_discord_allowed_servers,
    get_discord_allowed_users,
    get_gateway_agent,
    get_platform_token,
    is_edit_allowed,
)
from cli.gateway.discord_session import DiscordSessionManager
from cli.gateway.runners.base import AgentRunner

log = logging.getLogger(__name__)


def get_runner() -> AgentRunner:
    """Instantiate the configured AgentRunner."""
    agent_key = get_gateway_agent()
    if agent_key == "llamacpp":
        from cli.gateway.runners.llamacpp import LlamaCppRunner
        return LlamaCppRunner()
    if agent_key == "claude-code":
        from cli.gateway.runners.claude_code import ClaudeCodeRunner
        return ClaudeCodeRunner(bin_path=get_agent_bin_path("claude-code"))
    if agent_key == "codex":
        from cli.gateway.runners.codex import CodexRunner
        return CodexRunner(
            bin_path=get_agent_bin_path("codex"),
            api_key=get_agent_api_key("codex"),
        )
    raise NotImplementedError(f"Runner '{agent_key}' not yet supported in gateway.")


class YipsDiscordBot(discord.Client):
    """Discord bot that routes messages to the configured Yips AgentRunner."""

    def __init__(self, on_activity: Callable[[], None] | None = None) -> None:
        intents = discord.Intents.default()
        intents.message_content = True  # privileged — enable in Discord Developer Portal
        intents.guilds = True
        intents.members = True  # privileged — also enable in Discord Developer Portal
        super().__init__(intents=intents)
        self._on_activity = on_activity
        self._session_mgr = DiscordSessionManager(
            on_session_saved=self._handle_session_saved
        )
        self._session_mgr.load_sessions_from_disk()

    def _handle_session_saved(self, channel_id: str, session_file_path: Path) -> None:
        if self._on_activity is None:
            return
        try:
            self._on_activity()
        except Exception as exc:
            log.warning(
                "Discord activity callback failed for channel %s (%s): %s",
                channel_id,
                session_file_path,
                exc,
            )

    async def on_ready(self) -> None:
        # Status is shown during the boot spinner — no print here to avoid
        # polluting the title box / prompt area after the screen clears.
        pass

    @staticmethod
    def _build_message_context(
        message: discord.Message, bot_user: discord.ClientUser
    ) -> dict:
        """Return a DiscordMessageContext dict from a discord.Message."""
        channel = message.channel

        if isinstance(channel, discord.DMChannel):
            channel_type = "dm"
        elif isinstance(channel, discord.Thread):
            channel_type = "thread"
        elif isinstance(channel, discord.TextChannel):
            channel_type = "guild_text"
        else:
            channel_type = "other"

        guild = message.guild
        guild_id: str | None = str(guild.id) if guild else None
        guild_name: str | None = guild.name if guild else None

        is_bot_mentioned = bot_user in message.mentions

        reply_to_id: str | None = None
        if message.reference is not None and message.reference.message_id is not None:
            reply_to_id = str(message.reference.message_id)

        return {
            "source": "discord",
            "message_id": str(message.id),
            "channel_id": str(channel.id),
            "channel_name": getattr(channel, "name", "dm"),
            "channel_type": channel_type,
            "guild_id": guild_id,
            "guild_name": guild_name,
            "author_id": str(message.author.id),
            "author_username": message.author.name,
            "author_display_name": message.author.display_name,
            "is_bot_mentioned": is_bot_mentioned,
            "reply_to_message_id": reply_to_id,
            "timestamp": message.created_at.astimezone(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
        }

    async def on_message(self, message: discord.Message) -> None:
        # Ignore own messages
        if message.author == self.user:
            return

        # Filter by allowed servers (guild IDs)
        allowed_servers = get_discord_allowed_servers()
        if allowed_servers and message.guild:
            if str(message.guild.id) not in allowed_servers:
                return

        # Filter by allowed channels
        allowed_channels = get_discord_allowed_channels()
        if allowed_channels:
            if str(message.channel.id) not in allowed_channels:
                return

        # Filter by allowed users
        allowed_users = get_discord_allowed_users()
        if allowed_users:
            if str(message.author.id) not in allowed_users:
                return

        await self._handle_message(message)

    async def _handle_message(self, message: discord.Message) -> None:
        # Handle reset commands
        stripped = message.content.strip().lower()
        if stripped in ("!reset", "!new"):
            self._session_mgr.reset_session(str(message.channel.id))
            await message.reply("Session cleared. Starting fresh!")
            return

        # React with eyes to acknowledge receipt
        try:
            await message.add_reaction("👀")
        except discord.DiscordException:
            pass  # cosmetic — don't abort on failure

        user_id = str(message.author.id)
        can_edit = is_edit_allowed(user_id)

        channel_id = str(message.channel.id)
        server_name = message.guild.name if message.guild else "DM"
        channel_name = getattr(message.channel, "name", None) or message.author.display_name or message.author.name
        username = message.author.display_name

        # Build structured context for this message
        msg_context = self._build_message_context(message, self.user)  # type: ignore[arg-type]

        # Try to reconnect a restored-from-disk session first
        self._session_mgr.reconnect_restored_session(channel_id, server_name, channel_name)

        # Ensure session exists
        self._session_mgr.get_or_create_session(channel_id, server_name, channel_name)

        # Grab history *before* adding the new message (so it's prior context)
        history = self._session_mgr.get_history_for_runner(channel_id)

        # Record the user message (with structured metadata)
        self._session_mgr.add_user_message(
            channel_id, username, message.content, metadata=msg_context
        )
        self._session_mgr.save_session(channel_id)

        # Format prompt with username so the AI knows who's speaking
        formatted_content = f"{username}: {message.content}"

        # ── Slash command interception (before AI runner) ──────────────────────
        if message.content.strip().startswith("/"):
            from cli.gateway.gateway_commands import handle_gateway_slash_command
            cmd_result = handle_gateway_slash_command(
                message.content.strip(), channel_id, self._session_mgr
            )
            if cmd_result is not None:
                if cmd_result == "::GATEWAY_RESET::":
                    self._session_mgr.reset_session(channel_id)
                    try:
                        await message.remove_reaction("👀", self.user)  # type: ignore[arg-type]
                    except discord.DiscordException:
                        pass
                    await message.reply("Session cleared. Starting fresh!")
                    return
                if cmd_result.startswith("::GATEWAY_REPROMPT::"):
                    # Extract the reprompt message and fall through to the AI runner
                    formatted_content = cmd_result[len("::GATEWAY_REPROMPT::"):]
                else:
                    # Direct reply — send and return
                    try:
                        await message.remove_reaction("👀", self.user)  # type: ignore[arg-type]
                    except discord.DiscordException:
                        pass
                    chunks = [cmd_result[i : i + 1990] for i in range(0, len(cmd_result), 1990)]
                    for chunk in chunks:
                        await message.reply(chunk)
                    return
        # ── End slash command interception ─────────────────────────────────────

        response: str | None = None
        error: Exception | None = None

        try:
            runner = get_runner()
            async with message.channel.typing():
                response = await asyncio.to_thread(
                    runner.run,
                    formatted_content,
                    can_edit=can_edit,
                    history=history,
                    message_context=msg_context,
                )
        except Exception as exc:
            error = exc

        # Remove eyes reaction
        try:
            await message.remove_reaction("👀", self.user)  # type: ignore[arg-type]
        except discord.DiscordException:
            pass  # cosmetic — don't abort on failure

        if error:
            await message.reply(f"Error: {error}")
            return

        # Record assistant response and persist
        text = response or "(no response)"
        self._session_mgr.add_assistant_message(channel_id, text)
        self._session_mgr.save_session(channel_id)

        # Discord hard limit is 2000 chars — chunk if needed
        chunks = [text[i : i + 1990] for i in range(0, len(text), 1990)]
        for chunk in chunks:
            await message.reply(chunk)


def run_discord_bot() -> None:
    """Start the Yips Discord bot. Blocks until Ctrl+C or a fatal error."""
    token = get_platform_token("discord")
    if not token:
        print("  Error: Discord token not set. Run /gateway to configure.")
        return

    bot = YipsDiscordBot()
    try:
        print("  Starting Yips Discord bot — Ctrl+C to stop.")
        bot.run(token, log_handler=None)
    except KeyboardInterrupt:
        print("\n  Discord bot stopped.")
    except discord.LoginFailure:
        print("  Error: Invalid token. Run /gateway to reconfigure.")
    except Exception as exc:
        print(f"  Discord bot crashed: {exc}")
