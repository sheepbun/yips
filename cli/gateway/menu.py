"""PromptToolkit menu for the Yips Gateway panel."""

from __future__ import annotations

from typing import Callable, Sequence

from prompt_toolkit import Application
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Layout
from prompt_toolkit.layout.containers import HSplit, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.output.color_depth import ColorDepth
from prompt_toolkit.widgets import Box

from cli.color_utils import console
from cli.gateway.config import mask_token
from cli.ui_frames import GradientFrame


MENU_ACTIONS: Sequence[tuple[str, str]] = (
    ("Set Telegram token", "set_telegram"),
    ("Set Discord token", "set_discord"),
    ("Remove Telegram token", "remove_telegram"),
    ("Remove Discord token", "remove_discord"),
    ("Restart gateway service", "restart"),
    ("Refresh status", "refresh"),
    ("Exit menu", "exit"),
)


class GatewayMenu:
    def __init__(
        self,
        get_config: Callable[[], dict[str, str]],
        get_service_status: Callable[[], tuple[bool, str]],
        action_handlers: dict[str, Callable[[], None]],
    ) -> None:
        self.get_config = get_config
        self.get_service_status = get_service_status
        self.action_handlers = action_handlers
        self.selected_index = 0
        self.service_output = ""
        self.service_available = False
        self._update_service_status()

        self._kb = self._build_key_bindings()
        body = Box(
            HSplit(
                [
                    Window(content=FormattedTextControl(self._render_tokens), dont_extend_height=True),
                    Window(height=1, char="─", style="dim"),
                    Window(content=FormattedTextControl(self._render_service), wrap_lines=True, dont_extend_height=True),
                    Window(height=1, char="─", style="dim"),
                    Window(content=FormattedTextControl(self._render_actions), wrap_lines=True, dont_extend_height=True),
                ],
                padding=1,
            )
        )
        frame = GradientFrame(body, title="Yips Model Gateway")
        self._layout = Layout(frame.container)
        self._app = Application(
            layout=self._layout,
            key_bindings=self._kb,
            full_screen=False,
            mouse_support=False,
            color_depth=ColorDepth.TRUE_COLOR,
        )

    def _update_service_status(self) -> None:
        success, output = self.get_service_status()
        self.service_available = success
        self.service_output = output

    def _render_tokens(self) -> list[tuple[str, str]]:
        config = self.get_config()
        return [
            ("bold magenta", "Telegram: "),
            ("bold cyan", mask_token(config.get("telegram_token"))),
            ("", "\n"),
            ("bold magenta", "Discord: "),
            ("bold cyan", mask_token(config.get("discord_token"))),
        ]

    def _render_service(self) -> list[tuple[str, str]]:
        header_style = "bold green" if self.service_available else "bold yellow"
        header = [("", ""), (header_style, "Gateway service status:\n")]
        lines = self.service_output.strip().splitlines()
        if not lines:
            lines = ["(no status available)"]
        snippet = lines[:6]
        text = "\n".join(snippet)
        if len(lines) > 6:
            text += "\n…"
        header.append(("white", text))
        return header

    def _render_actions(self) -> list[tuple[str, str]]:
        fragments: list[tuple[str, str]] = []
        for idx, (label, _) in enumerate(MENU_ACTIONS):
            style = "reverse bold" if idx == self.selected_index else ""
            prefix = "▶ " if idx == self.selected_index else "  "
            fragments.append((style, f"{prefix}{label}\n"))
        return fragments

    def _build_key_bindings(self) -> KeyBindings:
        kb = KeyBindings()

        @kb.add("down")
        def _down(event) -> None:
            self.selected_index = (self.selected_index + 1) % len(MENU_ACTIONS)
            event.app.invalidate()

        @kb.add("up")
        def _up(event) -> None:
            self.selected_index = (self.selected_index - 1) % len(MENU_ACTIONS)
            event.app.invalidate()

        @kb.add("enter")
        def _enter(event) -> None:
            _, action_id = MENU_ACTIONS[self.selected_index]
            if action_id == "exit":
                event.app.exit()
                return

            handler = self.action_handlers.get(action_id)
            if handler:
                handler()
            self._update_service_status()
            event.app.invalidate()

        @kb.add("escape", "q", "c-c")
        def _exit(event) -> None:
            event.app.exit()

        return kb

    def run(self) -> None:
        self._app.run()
