"""
Yips Model Gateway TUI — interactive platform + agent configuration screen.

Modeled on cli/model_manager.py and cli/download_ui.py.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from prompt_toolkit import Application
from prompt_toolkit.filters import Condition
from prompt_toolkit.formatted_text import StyleAndTextTuples
from prompt_toolkit.key_binding import KeyBindings, KeyPressEvent
from prompt_toolkit.layout.containers import ConditionalContainer, HSplit, VSplit, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import TextArea

from cli.color_utils import (
    GRADIENT_BLUE,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    console,
    interpolate_color,
)
from cli.gateway.config import (
    get_agent_api_key,
    get_agent_bin_path,
    get_gateway_agent,
    get_platform_token,
    mask_token,
    remove_platform_token,
    set_agent_api_key,
    set_agent_bin_path,
    set_gateway_agent,
    set_platform_token,
)
from cli.ui_frames import GradientFrame


class GatewayUI:
    """Two-panel TUI for configuring gateway platforms and AI agents."""

    # (key, display_label)
    PLATFORMS: list[tuple[str, str]] = [
        ("whatsapp", "WhatsApp"),
        ("telegram", "Telegram"),
        ("discord", "Discord"),
    ]

    # (key, display_name, description)
    AGENTS: list[tuple[str, str, str]] = [
        ("llamacpp", "llamacpp", "local models"),
        ("claude", "claude", "Anthropic API"),
        ("claude-code", "claude-code", "CLI agent"),
        ("codex", "codex", "OpenAI CLI"),
    ]

    def __init__(self) -> None:
        self.active_panel: Literal["platforms", "agents"] = "platforms"
        self.platform_idx: int = 0
        self.agent_idx: int = self._current_agent_idx()

        self.editing_platform: bool = False
        self._editing_key: str = ""
        self._editing_label: str = ""

        self.style = Style.from_dict(
            {
                "status": "#888888",
            }
        )

        # Controls
        self._platforms_control = FormattedTextControl(
            text=self._render_platforms,
            focusable=True,
            show_cursor=False,
        )
        self._agents_control = FormattedTextControl(
            text=self._render_agents,
            focusable=False,
            show_cursor=False,
        )
        self._hints_control = FormattedTextControl(
            text=self._render_hints,
        )
        self._edit_label_control = FormattedTextControl(
            text=self._render_edit_label,
        )

        self._token_edit = TextArea(
            multiline=False,
            style="#ffccff",
            wrap_lines=False,
        )

        kb = self._build_key_bindings()

        body = VSplit(
            [
                Window(
                    content=self._platforms_control,
                    width=30,
                ),
                Window(width=1, char="│", style="class:status"),
                Window(
                    content=self._agents_control,
                ),
            ]
        )

        not_editing = Condition(lambda: not self.editing_platform)
        is_editing = Condition(lambda: self.editing_platform)

        hints_row = ConditionalContainer(
            content=Window(
                content=self._hints_control,
                height=1,
                style="class:status",
            ),
            filter=not_editing,
        )
        edit_row = ConditionalContainer(
            content=HSplit(
                [
                    Window(
                        content=self._edit_label_control,
                        height=1,
                    ),
                    self._token_edit,
                ]
            ),
            filter=is_editing,
        )

        main_content = HSplit(
            [
                body,
                Window(height=1, char=" "),
                hints_row,
                edit_row,
            ]
        )

        frame = GradientFrame(main_content, title="Yips Model Gateway")
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

    def _current_agent_idx(self) -> int:
        current = get_gateway_agent()
        for i, (key, _, _) in enumerate(self.AGENTS):
            if key == current:
                return i
        return 0

    def _gradient_row(self, text: str, focused: bool) -> StyleAndTextTuples:
        """Render a single selected row with pink→yellow gradient background."""
        if not focused:
            return [("#888888", text)]
        line_len = len(text)
        result: StyleAndTextTuples = []
        for col, char in enumerate(text):
            progress = col / max(line_len - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            result.append((f"bg:#{r:02x}{g:02x}{b:02x} #000000", char))
        return result

    def _agent_bullet_style(self, is_active_agent: bool) -> str:
        """Return pink hex color for the active-agent bullet."""
        r, g, b = GRADIENT_PINK
        return f"#{r:02x}{g:02x}{b:02x}"

    # ------------------------------------------------------------------ renders

    def _render_platforms(self) -> StyleAndTextTuples:
        from cli.gateway.discord_service import is_discord_running

        fragments: StyleAndTextTuples = []

        # Header
        fragments.append(("#888888", " PLATFORMS\n"))
        fragments.append(("#888888", " " + "─" * 26 + "\n"))

        for i, (key, label) in enumerate(self.PLATFORMS):
            token = get_platform_token(key)
            masked = mask_token(token)
            is_selected = (i == self.platform_idx)
            is_editing_row = self.editing_platform and key == self._editing_key
            cursor = "▶" if is_selected else " "

            # Show LIVE indicator for Discord when the bot is running
            live_tag = ""
            if key == "discord" and is_discord_running():
                live_tag = " LIVE"

            edit_tag = " [editing]" if is_editing_row else ""

            row = f" {cursor} {label:<12} {masked}\n"

            if is_selected:
                focused = self.active_panel == "platforms"
                if live_tag or edit_tag:
                    row_no_nl = row.rstrip("\n")
                    fragments.extend(self._gradient_row(row_no_nl, focused))
                    if live_tag:
                        fragments.append(("bg:#00cc66 #000000 bold", live_tag))
                    if edit_tag:
                        fragments.append(("#ffff66 bold", edit_tag))
                    fragments.append(("", "\n"))
                else:
                    fragments.extend(self._gradient_row(row, focused))
            else:
                if live_tag or edit_tag:
                    row_no_nl = row.rstrip("\n")
                    fragments.append(("", row_no_nl))
                    if live_tag:
                        fragments.append(("#00cc66 bold", live_tag))
                    if edit_tag:
                        fragments.append(("#ffff66 bold", edit_tag))
                    fragments.append(("", "\n"))
                else:
                    fragments.append(("", row))

        return fragments

    def _render_agents(self) -> StyleAndTextTuples:
        fragments: StyleAndTextTuples = []

        # Header
        blue_hex = f"#{GRADIENT_BLUE[0]:02x}{GRADIENT_BLUE[1]:02x}{GRADIENT_BLUE[2]:02x}"
        fragments.append(("#888888", " AGENTS\n"))
        fragments.append(("#888888", " " + "─" * 36 + "\n"))

        current_agent = get_gateway_agent()

        for i, (key, name, desc) in enumerate(self.AGENTS):
            is_selected = (i == self.agent_idx)
            is_active = (key == current_agent)
            cursor = "▶" if is_selected else " "
            bullet = "●" if is_active else " "
            row = f" {cursor} {bullet} {name:<14} {desc}\n"

            if is_selected:
                focused = self.active_panel == "agents"
                fragments.extend(self._gradient_row(row, focused))
            elif is_active:
                # Active agent gets blue bullet highlight
                fragments.append((blue_hex, row))
            else:
                fragments.append(("", row))

        return fragments

    def _render_hints(self) -> StyleAndTextTuples:
        return [
            ("#888888", " [Tab] Switch  [↑/↓] Move  [Enter] Configure  [D/Del] Clear token  [Esc] Exit")
        ]

    def _render_edit_label(self) -> StyleAndTextTuples:
        label = self._editing_label or "Token"
        return [
            ("#ffccff bold", f"  {label} token "),
            ("#888888", "— [Enter] Save  [Esc] Cancel"),
        ]

    # ------------------------------------------------------------------ keys

    def _build_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()

        not_editing = Condition(lambda: not self.editing_platform)
        is_editing = Condition(lambda: self.editing_platform)

        @kb.add("tab", filter=not_editing)
        def _tab(event: KeyPressEvent) -> None:
            self.active_panel = (
                "agents" if self.active_panel == "platforms" else "platforms"
            )
            event.app.invalidate()

        @kb.add("up", filter=not_editing)
        def _up(event: KeyPressEvent) -> None:
            if self.active_panel == "platforms":
                self.platform_idx = (self.platform_idx - 1) % len(self.PLATFORMS)
            else:
                self.agent_idx = (self.agent_idx - 1) % len(self.AGENTS)
            event.app.invalidate()

        @kb.add("down", filter=not_editing)
        def _down(event: KeyPressEvent) -> None:
            if self.active_panel == "platforms":
                self.platform_idx = (self.platform_idx + 1) % len(self.PLATFORMS)
            else:
                self.agent_idx = (self.agent_idx + 1) % len(self.AGENTS)
            event.app.invalidate()

        @kb.add("enter", filter=not_editing)
        async def _enter(event: KeyPressEvent) -> None:
            if self.active_panel == "platforms":
                self._enter_edit_mode(event)
            else:
                await self._configure_agent(event)

        @kb.add("enter", filter=is_editing)
        def _enter_commit(event: KeyPressEvent) -> None:
            self._commit_edit(event)

        @kb.add("d", filter=not_editing)
        @kb.add("delete", filter=not_editing)
        def _delete(event: KeyPressEvent) -> None:
            if self.active_panel == "platforms":
                key, label = self.PLATFORMS[self.platform_idx]
                remove_platform_token(key)
            event.app.invalidate()

        @kb.add("escape", filter=not_editing)
        @kb.add("q", filter=not_editing)
        @kb.add("c-c", filter=not_editing)
        def _exit(event: KeyPressEvent) -> None:
            event.app.exit()

        @kb.add("escape", filter=is_editing)
        @kb.add("c-c", filter=is_editing)
        def _cancel_edit(event: KeyPressEvent) -> None:
            self._exit_edit_mode(event)
            event.app.invalidate()

        return kb

    # ------------------------------------------------------------------ actions

    def _enter_edit_mode(self, event: KeyPressEvent) -> None:
        """Open the inline token composer for the selected platform."""
        key, label = self.PLATFORMS[self.platform_idx]
        existing = get_platform_token(key) or ""

        self._editing_key = key
        self._editing_label = label
        self.editing_platform = True

        buf = self._token_edit.buffer
        buf.text = existing
        buf.cursor_position = len(existing)

        event.app.layout.focus(self._token_edit)
        event.app.invalidate()

    def _exit_edit_mode(self, event: KeyPressEvent) -> None:
        """Leave edit mode without persisting and restore list focus."""
        self.editing_platform = False
        self._editing_key = ""
        self._editing_label = ""
        self._token_edit.buffer.text = ""
        try:
            event.app.layout.focus(self._platforms_control)
        except Exception:
            pass

    def _commit_edit(self, event: KeyPressEvent) -> None:
        """Persist the composer's token then exit edit mode."""
        key = self._editing_key
        if not key:
            self._exit_edit_mode(event)
            event.app.invalidate()
            return

        token = self._token_edit.buffer.text.strip()
        # Clean up bracketed paste markers and accidental quotes
        token = token.replace("\x1b[200~", "").replace("\x1b[201~", "").strip("\"'")
        
        if token:
            set_platform_token(key, token)
        else:
            remove_platform_token(key)

        launch_discord = key == "discord" and bool(token)
        self._exit_edit_mode(event)

        if launch_discord:
            event.app.exit(result="discord_config")
            return

        event.app.invalidate()

    async def _configure_agent(self, event: KeyPressEvent) -> None:
        """Select the active gateway agent, prompting for extra config if needed."""
        from prompt_toolkit.application import run_in_terminal

        key, name, _ = self.AGENTS[self.agent_idx]

        def _get_input() -> None:
            try:
                if key in ("claude-code", "codex"):
                    current_bin = get_agent_bin_path(key)
                    hint = f"  {name} binary path (blank = use PATH"
                    if current_bin:
                        hint += f", current: {current_bin}"
                    hint += "): "
                    bin_path = input(hint)
                    if bin_path.strip():
                        set_agent_bin_path(key, bin_path)

                if key == "codex":
                    current_key = get_agent_api_key(key)
                    env_key = os.environ.get("OPENAI_API_KEY", "")
                    if not env_key:
                        hint = "  OpenAI API key (blank to keep current"
                        if current_key:
                            hint += f", current: {mask_token(current_key)}"
                        hint += "): "
                        api_key = input(hint)
                        if api_key.strip():
                            set_agent_api_key(key, api_key)

            except (KeyboardInterrupt, EOFError):
                pass

            set_gateway_agent(key)

        await run_in_terminal(_get_input)
        event.app.invalidate()

    # ------------------------------------------------------------------ run

    def run(self) -> Any:
        return self._app.run()


def run_gateway_ui(agent: Any) -> None:
    """Launch the Yips Model Gateway management screen."""
    while True:
        ui = GatewayUI()
        with agent.modal_prompt_application(ui._app):
            result = ui.run()
        if result == "discord_config":
            from cli.gateway.discord_config_ui import DiscordConfigUI

            dc = DiscordConfigUI()
            with agent.modal_prompt_application(dc._app):
                dc.run()
            continue  # re-enter Gateway UI after Discord config
        break
