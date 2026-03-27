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
from cli.gateway.runners.base import AgentRunner


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

    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.message_content = True  # privileged — enable in Discord Developer Portal
        intents.guilds = True
        super().__init__(intents=intents)

    async def on_ready(self) -> None:
        # Status is shown during the boot spinner — no print here to avoid
        # polluting the title box / prompt area after the screen clears.
        pass

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
        # React with eyes to acknowledge receipt
        try:
            await message.add_reaction("👀")
        except discord.DiscordException:
            pass  # cosmetic — don't abort on failure

        user_id = str(message.author.id)
        can_edit = is_edit_allowed(user_id)

        response: str | None = None
        error: Exception | None = None

        try:
            runner = get_runner()
            async with message.channel.typing():
                # AgentRunner.run() is synchronous/blocking.
                # asyncio.to_thread() offloads it to a thread pool so the
                # Discord event loop remains free during the (potentially long) call.
                response = await asyncio.to_thread(runner.run, message.content, can_edit=can_edit)
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

        # Discord hard limit is 2000 chars — chunk if needed
        text = response or "(no response)"
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
