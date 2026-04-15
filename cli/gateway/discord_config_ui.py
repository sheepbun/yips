"""
Discord configuration TUI — API-driven server/channel/user selection.

Two phases (token entry happens in GatewayUI before this screen launches):
  1. Loading spinner while fetching guilds, channels, members
  2. Checkbox selection lists for servers, channels, users
"""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field
from typing import Any, Literal

from prompt_toolkit import Application
from prompt_toolkit.formatted_text import StyleAndTextTuples
from prompt_toolkit.key_binding import KeyBindings, KeyPressEvent
from prompt_toolkit.layout.containers import HSplit, VSplit, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.styles import Style

from cli.color_utils import (
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    console,
    interpolate_color,
)
from cli.gateway.config import (
    get_discord_allowed_channels,
    get_discord_allowed_servers,
    get_discord_allowed_users,
    get_discord_edit_allowed_users,
    get_platform_token,
    set_discord_allowed_channels,
    set_discord_allowed_servers,
    set_discord_allowed_users,
    set_discord_edit_allowed_users,
)
from cli.ui_frames import GradientFrame


# ---------------------------------------------------------------------------
#  Data types
# ---------------------------------------------------------------------------

@dataclass
class SelectableItem:
    """A selectable item with a human-readable name and snowflake ID."""
    id: str
    name: str
    checked: bool = False


@dataclass
class DiscordData:
    """Data fetched from the Discord API."""
    servers: list[SelectableItem] = field(default_factory=list)
    channels: list[SelectableItem] = field(default_factory=list)
    users: list[SelectableItem] = field(default_factory=list)
    editors: list[SelectableItem] = field(default_factory=list)
    error: str | None = None


# ---------------------------------------------------------------------------
#  Fetcher — temporary client to pull guilds / channels / members
# ---------------------------------------------------------------------------

class DiscordFetcher:
    """Connect with a temporary discord.Client, fetch data, disconnect."""

    @staticmethod
    async def fetch(token: str) -> DiscordData:
        import discord

        data = DiscordData()
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.members = True  # privileged — best-effort
        client = discord.Client(intents=intents)

        ready_event = asyncio.Event()

        @client.event
        async def on_ready() -> None:
            ready_event.set()

        try:
            # Start the client in the background
            task = asyncio.ensure_future(client.start(token))

            # Wait for ready (or task completion or timeout)
            wait_task = asyncio.create_task(ready_event.wait())
            done, pending = await asyncio.wait(
                [wait_task, task],
                return_when=asyncio.FIRST_COMPLETED,
                timeout=15,
            )

            if not done:
                data.error = "Timed out connecting to Discord."
                task.cancel()
                wait_task.cancel()
                return data

            # Cancel remaining pending tasks (either start() or wait())
            for p in pending:
                p.cancel()

            if task in done and task.exception():
                raise task.exception()

            # Fetch guilds
            for guild in client.guilds:
                data.servers.append(SelectableItem(id=str(guild.id), name=guild.name))

                # Text channels
                for channel in guild.text_channels:
                    display = f"#{channel.name}  ({guild.name})"
                    data.channels.append(SelectableItem(id=str(channel.id), name=display))

                # Members — requires Server Members Intent.  Fallback to cached.
                try:
                    members = guild.members
                    if len(members) <= 1:
                        # Cache likely stale — attempt explicit fetch
                        try:
                            async for member in guild.fetch_members(limit=200):
                                if member.bot:
                                    continue
                                tag = f"{member.name}#{member.discriminator}" if member.discriminator and member.discriminator != "0" else member.name
                                display = f"{member.display_name}  ({tag}, {guild.name})"
                                data.users.append(SelectableItem(id=str(member.id), name=display))
                        except Exception:
                            pass  # intent not enabled — skip
                    else:
                        for member in members:
                            if member.bot:
                                continue
                            tag = f"{member.name}#{member.discriminator}" if member.discriminator and member.discriminator != "0" else member.name
                            display = f"{member.display_name}  ({tag}, {guild.name})"
                            data.users.append(SelectableItem(id=str(member.id), name=display))
                except Exception:
                    pass  # members not available

        except Exception as exc:  # noqa: BLE001
            # Login failure / network error
            err_name = type(exc).__name__
            data.error = f"{err_name}: {exc}"
        finally:
            try:
                await client.close()
            except Exception:
                pass

        # Deduplicate users by ID (may appear in multiple guilds)
        seen_ids: set[str] = set()
        unique_users: list[SelectableItem] = []
        for u in data.users:
            if u.id not in seen_ids:
                seen_ids.add(u.id)
                unique_users.append(u)
        data.users = unique_users

        return data


# ---------------------------------------------------------------------------
#  TUI
# ---------------------------------------------------------------------------

class DiscordConfigUI:
    """Two-phase Discord configuration screen (loading → selection).

    The bot token is collected by GatewayUI before this screen launches.
    """

    PHASE_LOADING = "loading"
    PHASE_SELECT = "select"

    def __init__(self) -> None:
        self.phase: str = self.PHASE_LOADING
        self.token: str = get_platform_token("discord") or ""

        # Selection state
        self.data: DiscordData = DiscordData()
        self.active_tab: Literal["servers", "channels", "users", "editors"] = "servers"
        self.tab_indices: dict[str, int] = {"servers": 0, "channels": 0, "users": 0, "editors": 0}
        self.scroll_offsets: dict[str, int] = {"servers": 0, "channels": 0, "users": 0, "editors": 0}

        # Loading state
        self._spinner_frame = 0

        self.style = Style.from_dict({"status": "#888888"})

        self._main_control = FormattedTextControl(
            text=self._render_main, focusable=False, show_cursor=False
        )
        self._hints_control = FormattedTextControl(text=self._render_hints)

        self._body_window = Window(content=self._main_control)

        kb = self._build_key_bindings()

        main_content = HSplit(
            [
                self._body_window,
                Window(height=1, char=" "),
                Window(content=self._hints_control, height=1, style="class:status"),
            ]
        )

        frame = GradientFrame(main_content, title="Yips Discord Config")
        self._layout = Layout(frame.container)

        self._app: Application[Any] = Application(
            layout=self._layout,
            key_bindings=kb,
            style=self.style,
            full_screen=False,
            mouse_support=False,
            color_depth=ColorDepth.TRUE_COLOR,
        )

    # ------------------------------------------------------------------ helpers

    def _gradient_row(self, text: str, focused: bool) -> StyleAndTextTuples:
        if not focused:
            return [("#888888", text)]
        line_len = len(text)
        result: StyleAndTextTuples = []
        for col, char in enumerate(text):
            progress = col / max(line_len - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            result.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000", char))
        return result

    def _items_for_tab(self) -> list[SelectableItem]:
        if self.active_tab == "servers":
            return self.data.servers
        if self.active_tab == "channels":
            return self.data.channels
        if self.active_tab == "editors":
            return self.data.editors
        return self.data.users

    # ------------------------------------------------------------------ renders

    def _render_main(self) -> StyleAndTextTuples:
        if self.phase == self.PHASE_LOADING:
            return self._render_loading_phase()
        return self._render_select_phase()

    def _render_loading_phase(self) -> StyleAndTextTuples:
        spinner_chars = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
        char = spinner_chars[self._spinner_frame % len(spinner_chars)]
        fragments: StyleAndTextTuples = []
        fragments.append(("#888888", "\n"))
        fragments.append(("#ffccff", f"  {char} Connecting to Discord...\n"))
        fragments.append(("#888888", "\n"))
        fragments.append(("#888888", "  Fetching servers, channels, and members.\n"))
        fragments.append(("#888888", "  This may take a few seconds.\n"))
        return fragments

    def _render_select_phase(self) -> StyleAndTextTuples:
        fragments: StyleAndTextTuples = []

        if self.data.error:
            fragments.append(("#888888", "\n"))
            fragments.append(("fg:red", f"  Error: {self.data.error}\n"))
            fragments.append(("#888888", "\n"))
            fragments.append(("#888888", "  Press [Esc] to go back.\n"))
            return fragments

        # Tab headers
        tabs = [
            ("servers", f"Servers ({len(self.data.servers)})"),
            ("channels", f"Channels ({len(self.data.channels)})"),
            ("users", f"Users ({len(self.data.users)})"),
            ("editors", f"Editors ({len(self.data.editors)})"),
        ]
        fragments.append(("#888888", "\n "))
        for key, label in tabs:
            if key == self.active_tab:
                pink_hex = f"#{GRADIENT_PINK[0]:02x}{GRADIENT_PINK[1]:02x}{GRADIENT_PINK[2]:02x}"
                fragments.append((f"{pink_hex} bold underline", f" {label} "))
            else:
                fragments.append(("#888888", f" {label} "))
            fragments.append(("#888888", "  "))
        fragments.append(("#888888", "\n"))
        fragments.append(("#888888", " " + "─" * 60 + "\n"))

        items = self._items_for_tab()
        idx = self.tab_indices[self.active_tab]
        max_visible = 12
        scroll = self.scroll_offsets[self.active_tab]

        if not items:
            fragments.append(("#888888", "  (none found)\n"))
            # Members intent note
            if self.active_tab == "users":
                fragments.append(("#888888", "\n"))
                fragments.append(("#888888", "  Note: Fetching members requires the Server Members\n"))
                fragments.append(("#888888", "  Intent enabled in the Discord Developer Portal.\n"))
        else:
            visible_items = items[scroll:scroll + max_visible]
            for vi, item in enumerate(visible_items):
                actual_idx = scroll + vi
                is_selected = actual_idx == idx
                check = "[x]" if item.checked else "[ ]"
                # Truncate name to fit
                max_name_len = 52
                display_name = item.name[:max_name_len] + "..." if len(item.name) > max_name_len else item.name
                row = f"  {check} {display_name}\n"
                if is_selected:
                    fragments.extend(self._gradient_row(row, True))
                else:
                    style = "#ffffff" if item.checked else "#888888"
                    fragments.append((style, row))

            if len(items) > max_visible:
                fragments.append(("#888888", f"  ({len(items)} total — scroll to see more)\n"))

        # Hint about empty selections
        fragments.append(("#888888", "\n"))
        checked = sum(1 for i in items if i.checked)
        if checked == 0:
            if self.active_tab == "editors":
                fragments.append(("#888888", "  No selections = no edit access\n"))
            else:
                fragments.append(("#888888", "  No selections = allow all\n"))
        else:
            fragments.append(("#888888", f"  {checked} selected\n"))

        return fragments

    def _render_hints(self) -> StyleAndTextTuples:
        if self.phase == self.PHASE_LOADING:
            return [("#888888", " Connecting...  [Esc] Cancel")]
        return [
            ("#888888", " [Tab] Switch panel  [↑/↓] Move  [Space] Toggle  [Enter] Save  [Esc] Cancel")
        ]

    # ------------------------------------------------------------------ keys

    def _build_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()

        @kb.add("enter")
        def _enter(event: KeyPressEvent) -> None:
            if self.phase == self.PHASE_SELECT:
                if self.data.error:
                    event.app.exit()
                    return
                self._save_selections()
                event.app.exit()

        @kb.add("tab")
        def _tab(event: KeyPressEvent) -> None:
            if self.phase == self.PHASE_SELECT:
                order = ["servers", "channels", "users", "editors"]
                cur = order.index(self.active_tab)
                self.active_tab = order[(cur + 1) % len(order)]  # type: ignore[assignment]
                event.app.invalidate()

        @kb.add("s-tab")
        def _stab(event: KeyPressEvent) -> None:
            if self.phase == self.PHASE_SELECT:
                order = ["servers", "channels", "users", "editors"]
                cur = order.index(self.active_tab)
                self.active_tab = order[(cur - 1) % len(order)]  # type: ignore[assignment]
                event.app.invalidate()

        @kb.add("up")
        def _up(event: KeyPressEvent) -> None:
            if self.phase == self.PHASE_SELECT:
                items = self._items_for_tab()
                if items:
                    idx = self.tab_indices[self.active_tab]
                    idx = (idx - 1) % len(items)
                    self.tab_indices[self.active_tab] = idx
                    self._adjust_scroll()
                    event.app.invalidate()

        @kb.add("down")
        def _down(event: KeyPressEvent) -> None:
            if self.phase == self.PHASE_SELECT:
                items = self._items_for_tab()
                if items:
                    idx = self.tab_indices[self.active_tab]
                    idx = (idx + 1) % len(items)
                    self.tab_indices[self.active_tab] = idx
                    self._adjust_scroll()
                    event.app.invalidate()

        @kb.add("space")
        def _space(event: KeyPressEvent) -> None:
            if self.phase == self.PHASE_SELECT:
                items = self._items_for_tab()
                if items:
                    idx = self.tab_indices[self.active_tab]
                    items[idx].checked = not items[idx].checked
                    event.app.invalidate()

        @kb.add("escape")
        @kb.add("c-c")
        def _exit(event: KeyPressEvent) -> None:
            event.app.exit()

        return kb

    # ------------------------------------------------------------------ scrolling

    def _adjust_scroll(self) -> None:
        max_visible = 12
        idx = self.tab_indices[self.active_tab]
        scroll = self.scroll_offsets[self.active_tab]
        if idx < scroll:
            scroll = idx
        elif idx >= scroll + max_visible:
            scroll = idx - max_visible + 1
        self.scroll_offsets[self.active_tab] = scroll

    # ------------------------------------------------------------------ fetching

    def _start_fetch(self) -> None:
        """Launch background fetch thread."""
        token = self.token

        def _worker() -> None:
            loop = asyncio.new_event_loop()
            try:
                data = loop.run_until_complete(DiscordFetcher.fetch(token))
            except Exception as exc:
                data = DiscordData(error=str(exc))
            finally:
                loop.close()

            # Pre-check items that match existing config
            existing_servers = set(get_discord_allowed_servers())
            existing_channels = set(get_discord_allowed_channels())
            existing_users = set(get_discord_allowed_users())
            existing_editors = set(get_discord_edit_allowed_users())

            for item in data.servers:
                if item.id in existing_servers:
                    item.checked = True
            for item in data.channels:
                if item.id in existing_channels:
                    item.checked = True
            for item in data.users:
                if item.id in existing_users:
                    item.checked = True

            # Editors tab — copy of users list with independent checked state
            for user in data.users:
                editor_item = SelectableItem(
                    id=user.id,
                    name=user.name,
                    checked=user.id in existing_editors,
                )
                data.editors.append(editor_item)

            self.data = data
            self.phase = self.PHASE_SELECT
            # Animate spinner until data arrives
            try:
                self._app.invalidate()
            except Exception:
                pass

        # Spinner animation thread
        def _animate() -> None:
            import time
            while self.phase == self.PHASE_LOADING:
                self._spinner_frame += 1
                try:
                    self._app.invalidate()
                except Exception:
                    break
                time.sleep(0.08)

        threading.Thread(target=_worker, daemon=True).start()
        threading.Thread(target=_animate, daemon=True).start()

    # ------------------------------------------------------------------ save

    def _save_selections(self) -> None:
        """Persist checked items to config."""
        server_ids = [i.id for i in self.data.servers if i.checked]
        channel_ids = [i.id for i in self.data.channels if i.checked]
        user_ids = [i.id for i in self.data.users if i.checked]
        editor_ids = [i.id for i in self.data.editors if i.checked]

        set_discord_allowed_servers(server_ids)
        set_discord_allowed_channels(channel_ids)
        set_discord_allowed_users(user_ids)
        set_discord_edit_allowed_users(editor_ids)

        # Restart the bot so it picks up the new config cleanly
        from cli.gateway.discord_service import stop_discord_service, start_discord_service

        stop_discord_service()
        start_discord_service()

    # ------------------------------------------------------------------ run

    def run(self) -> None:
        # If jumping straight to loading phase, kick off fetch
        if self.phase == self.PHASE_LOADING:
            self._start_fetch()
        self._app.run()
