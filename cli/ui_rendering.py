"""
UI rendering utilities for Yips CLI.

Provides title box rendering, spinner animations, and logo generation.
"""

import math
import time

from rich.live import Live
from rich.spinner import Spinner
from rich._spinners import SPINNERS
from rich.text import Text

from cli.color_utils import (
    console,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
)
from cli.config import APP_VERSION

# Register custom clockwise 8-dot spinner
SPINNERS["clockwise_dots_8"] = {
    "interval": 80,
    "frames": ["⠹", "⢸", "⣰", "⣤", "⣆", "⡇", "⠏", "⠛"]
}

# Logo dimensions for width checks
LOGO_WIDTH = 28  # Width of the ASCII logo


class PulsingSpinner:
    """A Rich renderable that pulses a spinner and text between pink and yellow."""
    def __init__(self, message: str, start_time: float | None = None, token_count: int = 0, model_status: str = "thinking"):
        self.message = message
        self.spinner = Spinner("clockwise_dots_8")
        self.start_time = start_time if start_time is not None else time.time()
        self.model_status = model_status
        # Initialize with estimated token count until real data arrives
        self.input_tokens = token_count  # Start with estimate
        self.output_tokens = 0
        self.token_count = self.input_tokens + self.output_tokens

    def _format_time(self, seconds: float) -> str:
        m, s = divmod(int(seconds), 60)
        if m == 0:
            return f"{s}s"
        return f"{m}m {s}s"

    def update_tokens(self, input_tokens: int | None = None, output_tokens: int | None = None) -> None:
        """Update token counts (can be called during streaming)."""
        if input_tokens is not None:
            self.input_tokens = input_tokens
        if output_tokens is not None:
            self.output_tokens = output_tokens
        # Total for display
        self.token_count = self.input_tokens + self.output_tokens

    def update_status(self, status: str) -> None:
        """Update model status (thinking/generating/reasoning)."""
        self.model_status = status

    def __rich__(self) -> Spinner:
        # Pulse between 0 and 1 over ~3 seconds for a slow effect
        t = (math.sin(time.time() * 2.0) + 1) / 2
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, t)
        color = f"rgb({r},{g},{b})"
        
        elapsed = time.time() - self.start_time
        time_str = self._format_time(elapsed)
        
        # Format tokens (e.g., 5.6k)
        if self.token_count >= 1000:
            token_str = f"{self.token_count/1000:.1f}k"
        else:
            token_str = str(self.token_count)
            
        status_text = f" ({time_str} · ↓ {token_str} tokens · {self.model_status})"
        
        full_text = Text.assemble(
            (self.message, f"dim {color}"),
            (status_text, f"dim {color}")
        )
        
        self.spinner.text = full_text
        self.spinner.style = color
        return self.spinner


def generate_yips_logo() -> list[str]:
    """Generate YIPS ASCII art (6 lines)."""
    return [
        "██╗   ██╗██╗██████╗ ███████╗",
        "╚██╗ ██╔╝██║██╔══██╗██╔════╝",
        " ╚████╔╝ ██║██████╔╝███████╗",
        "  ╚██╔╝  ██║██╔═══╝ ╚════██║",
        "   ██║   ██║██║     ███████║",
        "   ╚═╝   ╚═╝╚═╝     ╚══════╝"
    ]


def safe_center(text: str, width: int) -> str:
    """Center text, truncating if too wide."""
    if len(text) > width:
        return text[:width]
    return text.center(width)


def show_loading(message: str = "Waiting for response...", token_count: int = 0) -> Live:
    """Create and return a Rich Live context with a pulsing pink->yellow loading spinner."""
    return Live(PulsingSpinner(message, token_count=token_count), console=console, transient=True, refresh_per_second=10)


def render_top_border(terminal_width: int) -> None:
    """Render the top border with gradient."""
    # For very narrow terminals, use simplified border
    if terminal_width < 25:
        border = "╭" + "─" * max(terminal_width - 2, 0) + "╮"
        top_text = Text()
        for i, char in enumerate(border):
            progress = i / max(len(border) - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            top_text.append(char, style=f"rgb({r},{g},{b})")
        console.print(top_text)
        return

    title_text = "Yips CLI"
    version_text = APP_VERSION
    title_length = len(title_text) + 1 + len(version_text)  # +1 for space
    border_available = terminal_width - title_length - 7  # 7 for ╭─── ╮

    # If terminal too narrow for full title, abbreviate
    if border_available < 0:
        # Use short title
        title_text = "Yips"
        title_length = len(title_text) + 1 + len(version_text)
        border_available = terminal_width - title_length - 7
        if border_available < 0:
            # Still too narrow - just show border with no title
            border = "╭" + "─" * max(terminal_width - 2, 0) + "╮"
            top_text = Text()
            for i, char in enumerate(border):
                progress = i / max(len(border) - 1, 1)
                r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                top_text.append(char, style=f"rgb({r},{g},{b})")
            console.print(top_text)
            return

    top_text = Text()
    position = 0

    # Opening border: "╭─── "
    opening = "╭─── "
    for char in opening:
        progress = position / max(terminal_width - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        top_text.append(char, style=f"rgb({r},{g},{b})")
        position += 1

    # Title with its own gradient
    for i, char in enumerate(title_text):
        title_progress = i / max(len(title_text) - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, title_progress)
        top_text.append(char, style=f"rgb({r},{g},{b})")
        position += 1

    # Space separator
    top_text.append(" ")
    position += 1

    # Version: solid blue
    r, g, b = GRADIENT_BLUE
    top_text.append(version_text, style=f"rgb({r},{g},{b})")
    position += len(version_text)

    # Closing border
    closing = " " + "─" * max(border_available, 0) + "╮"
    for char in closing:
        progress = position / max(terminal_width - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        top_text.append(char, style=f"rgb({r},{g},{b})")
        position += 1

    console.print(top_text)


def render_bottom_border(terminal_width: int, session_name: str | None = None) -> None:
    """Render the bottom border with gradient, optionally containing session name."""
    border_chars = ["─"] * (terminal_width - 2)

    if session_name:
        # Format: " name " (replace underscores with spaces for display)
        display_name = f" {session_name.replace('_', ' ')} "
        if len(display_name) <= len(border_chars):
            start_idx = (len(border_chars) - len(display_name)) // 2
            for i, char in enumerate(display_name):
                border_chars[start_idx + i] = char

    bottom_border_str = "╰" + "".join(border_chars) + "╯"

    bottom_text = Text()
    for i, char in enumerate(bottom_border_str):
        progress = i / max(len(bottom_border_str) - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        bottom_text.append(char, style=f"rgb({r},{g},{b})")

    console.print(bottom_text)
    console.print()
