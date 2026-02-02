"""
Color and gradient utilities for Yips CLI.

Provides gradient text rendering, color interpolation, and styled output functions.
"""

from rich.console import Console
from rich.text import Text
from datetime import datetime

# Type alias
RGBColor = tuple[int, int, int]

# Gradient colors: Deep strawberry pink -> Banana yellow -> Light blue raspberry
GRADIENT_PINK = (255, 20, 147)      # #FF1493
GRADIENT_YELLOW = (255, 225, 53)    # #FFE135
GRADIENT_BLUE = (137, 207, 240)     # #89CFF0

# User prompt color
PROMPT_COLOR = "#FFCCFF"

# Tool and system message color
TOOL_COLOR = f"rgb({GRADIENT_BLUE[0]},{GRADIENT_BLUE[1]},{GRADIENT_BLUE[2]})"

# Global console instance
console = Console()


def interpolate_color(c1: RGBColor, c2: RGBColor, t: float) -> RGBColor:
    """Linearly interpolate between two RGB colors."""
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
    )


def gradient_text(text: str) -> Text:
    """Create gradient-colored text: pink -> yellow. Skips leading/trailing whitespace."""
    styled = Text()

    if not text:
        return styled

    # Find start and end of non-whitespace content
    stripped_l = text.lstrip()
    if not stripped_l:
        # String is all whitespace
        styled.append(text)
        return styled

    leading_ws_len = len(text) - len(stripped_l)
    leading_ws = text[:leading_ws_len]

    stripped_full = stripped_l.rstrip()
    trailing_ws = stripped_l[len(stripped_full):]

    content = stripped_full
    length = len(content)

    # Append leading whitespace
    styled.append(leading_ws)

    # Apply gradient to content
    for i, char in enumerate(content):
        progress = i / max(length - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        styled.append(char, style=f"rgb({r},{g},{b})")

    # Append trailing whitespace
    styled.append(trailing_ws)

    return styled


def apply_gradient_to_text(text: str) -> Text:
    """Apply pink->yellow gradient to text for streaming display."""
    return gradient_text(text)


def get_yips_prefix() -> Text:
    """Create the 'Yips:' prefix with gradient on name and solid blue on timestamp/colon."""
    prefix = gradient_text("Yips")
    blue = f"rgb({GRADIENT_BLUE[0]},{GRADIENT_BLUE[1]},{GRADIENT_BLUE[2]})"
    
    timestamp = datetime.now().strftime(" [%-I:%M %p]:")
    prefix.append(timestamp, style=blue)
    prefix.append(" ")
    return prefix


def print_gradient(text: str) -> None:
    """Print text with gradient coloring."""
    console.print(gradient_text(text))


def print_yips(text: str) -> None:
    """Print Yips' response with gradient styling."""
    prefix = get_yips_prefix()
    indent = " " * len(prefix)

    final_text = Text()
    final_text.append_text(prefix)

    # Print response lines with gradient
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if i > 0:
            final_text.append("\n" + indent)
        final_text.append(gradient_text(line))

    console.print(final_text)
