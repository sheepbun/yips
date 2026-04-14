"""Gradient frame controls shared by model tools and the gateway."""

from __future__ import annotations

import os
from functools import partial
from typing import Any

from prompt_toolkit.formatted_text import AnyFormattedText, StyleAndTextTuples, to_formatted_text
from prompt_toolkit.formatted_text.utils import fragment_list_to_text
from prompt_toolkit.layout.containers import (
    DynamicContainer,
    HSplit,
    VSplit,
    Window,
)
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.widgets.base import Border

from cli.color_utils import (
    console,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
)


def _terminal_columns_for_layout() -> int:
    """Width in columns for TUI borders; match prompt_toolkit, not Rich's Console."""
    try:
        from prompt_toolkit.application import get_app

        app = get_app()
        return app.output.get_size().columns
    except Exception:
        pass
    try:
        return os.get_terminal_size().columns
    except OSError:
        pass
    return console.width or 80


class GradientFrame:
    """Yips-branded gradient border matching the Model Manager/Downloader style."""

    def __init__(self, body: Any, title: AnyFormattedText = "") -> None:
        self.body = body
        self.title = title
        self.container = DynamicContainer(self._get_container)

    def _get_diag_style(self, row_idx: int, col_idx: int, total_rows: int, total_cols: int) -> str:
        progress = col_idx / max(total_cols - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _get_top_row_fragments(self, total_rows: int, total_cols: int) -> StyleAndTextTuples:
        fragments: StyleAndTextTuples = []
        prefix = "╭─── "
        for i, char in enumerate(prefix):
            fragments.append((self._get_diag_style(0, i, total_rows, total_cols), char))

        full_title = fragment_list_to_text(to_formatted_text(self.title)).strip() or "Yips Model Gateway"
        if "Yips" in full_title:
            parts = full_title.split("Yips", 1)
            for i, char in enumerate("Yips"):
                progress = i / max(len("Yips") - 1, 1)
                r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                fragments.append((f"#{r:02x}{g:02x}{b:02x}", char))

            rest = parts[1]
            if rest:
                col_idx = len(fragments)
                fragments.append((self._get_diag_style(0, col_idx, total_rows, total_cols), " "))
                blue_hex = f"#{GRADIENT_BLUE[0]:02x}{GRADIENT_BLUE[1]:02x}{GRADIENT_BLUE[2]:02x}"
                for char in rest.strip():
                    fragments.append((blue_hex, char))
        else:
            for i, char in enumerate(full_title):
                col_idx = len(prefix) + i
                fragments.append((self._get_diag_style(0, col_idx, total_rows, total_cols), char))

        title_width = len(fragments)
        fragments.append((self._get_diag_style(0, title_width, total_rows, total_cols), " "))
        fill_width = max(total_cols - len(fragments) - 1, 0)
        for _ in range(fill_width):
            col_idx = len(fragments)
            fragments.append((self._get_diag_style(0, col_idx, total_rows, total_cols), Border.HORIZONTAL))
        fragments.append((self._get_diag_style(0, total_cols - 1, total_rows, total_cols), "╮"))
        return fragments

    def _get_bottom_row_fragments(self, total_rows: int, total_cols: int) -> StyleAndTextTuples:
        fragments: StyleAndTextTuples = []
        fragments.append((self._get_diag_style(total_rows - 1, 0, total_rows, total_cols), "╰"))
        for col_idx in range(1, total_cols - 1):
            fragments.append((self._get_diag_style(total_rows - 1, col_idx, total_rows, total_cols), Border.HORIZONTAL))
        fragments.append((self._get_diag_style(total_rows - 1, total_cols - 1, total_rows, total_cols), "╯"))
        return fragments

    def _get_container(self) -> HSplit:
        total_rows = 15
        total_cols = _terminal_columns_for_layout()

        body_container = VSplit(
            [
                Window(
                    width=1,
                    char=Border.VERTICAL,
                    style=partial(self._get_diag_style, total_rows // 2, 0, total_rows, total_cols),
                ),
                self.body,
                Window(
                    width=1,
                    char=Border.VERTICAL,
                    style=partial(self._get_diag_style, total_rows // 2, total_cols - 1, total_rows, total_cols),
                ),
            ]
        )

        return HSplit(
            [
                Window(
                    content=FormattedTextControl(self._get_top_row_fragments(total_rows, total_cols)),
                    height=1,
                ),
                body_container,
                Window(
                    content=FormattedTextControl(self._get_bottom_row_fragments(total_rows, total_cols)),
                    height=1,
                ),
            ]
        )
