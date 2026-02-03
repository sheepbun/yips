"""
UI rendering utilities for Yips CLI.

Provides title box rendering, spinner animations, and logo generation.
"""

import math
import time
import re
from typing import Any

from rich.live import Live
from rich.spinner import Spinner
from rich._spinners import SPINNERS
from rich.text import Text
from rich.tree import Tree
from rich.panel import Panel

from cli.color_utils import (
    console,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    TOOL_COLOR,
    blue_gradient_text,
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

        # Animation state
        self.target_input_tokens = token_count
        self.target_output_tokens = 0
        self.animated_input = 0  # Current animated value (starts at 0)
        self.animated_output = 0
        self.animation_start_time: float | None = None
        self.input_animation_duration = 0.5  # 500ms to count up input
        self.is_animating_input = False
        self.is_animating_output = False

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

    def start_input_animation(self, target: int) -> None:
        """Start animating input tokens from 0 to target."""
        self.target_input_tokens = target
        self.animated_input = 0
        self.is_animating_input = True
        self.animation_start_time = time.time()

    def update_output_animation(self, current: int) -> None:
        """Update output token count (incremental during streaming)."""
        self.target_output_tokens = current
        self.animated_output = current  # For output, we show real-time value
        self.is_animating_output = True
        self.is_animating_input = False  # Stop input animation

    def __rich__(self) -> Spinner:
        # Pulse between 0 and 1 over ~3 seconds for a slow effect
        t = (math.sin(time.time() * 2.0) + 1) / 2
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, t)
        color = f"rgb({r},{g},{b})"

        elapsed = time.time() - self.start_time
        time_str = self._format_time(elapsed)

        # Calculate current animated token count
        if self.is_animating_input and self.animation_start_time:
            # Animate input tokens counting up rapidly
            anim_elapsed = time.time() - self.animation_start_time
            progress = min(1.0, anim_elapsed / self.input_animation_duration)
            # Ease-out animation for smooth finish
            progress = 1 - (1 - progress) ** 2
            display_count = int(self.animated_input +
                              (self.target_input_tokens - self.animated_input) * progress)
            arrow = "↑"

            # Check if animation complete
            if progress >= 1.0:
                self.is_animating_input = False
                display_count = self.target_input_tokens

        elif self.is_animating_output:
            # Show real-time output tokens (already animated by streaming)
            # Include input tokens to show total context
            display_count = self.input_tokens + self.animated_output
            arrow = "↓"
        else:
            # Fallback: show whatever we have
            display_count = self.input_tokens + self.output_tokens if self.token_count > 0 else 0
            arrow = "↑"

        # Format tokens (5.6k for thousands)
        if display_count >= 1000:
            token_str = f"{display_count/1000:.1f}k"
        else:
            token_str = str(display_count)

        status_text = f" ({time_str})"

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


def render_tool_call(tool_name: str, parameters: dict[str, Any] | str, result: str | None = None, is_running: bool = False) -> Any:
    """Render a tool call in a beautiful way using Tree and Panel.
    Returns the Panel object for use with Live or direct printing.
    """
    import os
    if os.environ.get("YIPS_GUI_MODE") == "1":
        # Return a dictionary that can be JSON serialized
        return {
            "name": tool_name,
            "params": parameters,
            "result": result,
            "is_running": is_running
        }

    # Create the root node with a nice icon
    icon = "⚙️"
    if "read" in tool_name.lower(): icon = "📖"
    elif "write" in tool_name.lower(): icon = "📝"
    elif "command" in tool_name.lower(): icon = "💻"
    elif "skill" in tool_name.lower(): icon = "⚡"
    elif "identity" in tool_name.lower(): icon = "👤"
    
    tree = Tree(blue_gradient_text(f"{icon} {tool_name}"))

    # Parameters section
    if isinstance(parameters, dict):
        if parameters:
            param_node = tree.add(Text("Parameters", style="dim"))
            for key, value in parameters.items():
                value_str = str(value)
                if len(value_str) > 80:
                    value_str = value_str[:77] + "..."
                param_node.add(Text.assemble((f"{key}: ", "dim"), (value_str, TOOL_COLOR)))
    elif parameters:
        val = str(parameters).strip()
        if val:
            if len(val) > 80:
                val = val[:77] + "..."
            tree.add(Text.assemble(("Input: ", "dim"), (val, TOOL_COLOR)))

    # Status/Result section
    if is_running:
        # Use a simple pulsing dot or text for running state
        t = (math.sin(time.time() * 10.0) + 1) / 2
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, t)
        tree.add(Text("● Executing...", style=f"rgb({r},{g},{b})"))
    elif result is not None:
        if result == "":
            tree.add(Text("✓ Completed", style="dim"))
        else:
            res_tree = tree.add(blue_gradient_text("✓ Result"))
            # Truncate result for preview
            res_preview = result.strip()
            
            # Clean up result preview (remove [Command output]: etc)
            # Handle various common prefixes
            res_preview = re.sub(r"^[(Command output|File contents|File written|Skill output|stderr).*?]:\s*", "", res_preview, flags=re.IGNORECASE)
            res_preview = re.sub(r"^[(.*?)]\s*", "", res_preview) # Catch-all for other [Brackets]
            
            # Strip leading/trailing whitespace again after regex
            res_preview = res_preview.strip()
            
            if len(res_preview) > 500:
                res_preview = res_preview[:497] + "..."
            
            if not res_preview:
                res_preview = "Success (no output)"
                
            res_tree.add(Text(res_preview, style="dim"))

    return Panel(tree, border_style=TOOL_COLOR, expand=False, padding=(0, 1))


def render_thinking_block(thinking_text: str, is_streaming: bool = False) -> Panel:


    """Render a thinking block. Aggressively summarized to show high-level intent."""


    # Clean up the thinking text


    text = thinking_text.strip()


    if text.startswith("<think>"):


        text = text[7:].strip()


    if text.endswith("</think>"):


        text = text[:-8].strip()





    if not text:


        return Panel(Text("• Initializing thoughts...", style="dim italic"), border_style="dim white", expand=False, padding=(0, 1))





    # Heuristic for summarization:


    # 1. Split into paragraphs


    # 2. For each paragraph, extract the first sentence (the "topic" sentence)


    # 3. Filter out noise/monologue


    


    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]


    if not paragraphs:


        paragraphs = [l.strip() for l in text.split('\n') if l.strip()]





    summarized_points = []


    


    # Noise patterns to strip or skip


    noise_prefixes = [


        r"^i (will|need to|should|can|am going to|think|believe)\b",


        r"^let's\b",


        r"^first,\b",


        r"^then,\b",


        r"^next,\b",


        r"^finally,\b",


        r"^okay,\b",


        r"^so,\b",


        r"^actually,\b",


    ]





    for p in paragraphs:


        # Take the first sentence (up to the first period/question/exclamation)


        sentence = re.split(r'[.!?]\s', p)[0].strip()


        if not sentence: continue


        


        # Clean up markers


        sentence = re.sub(r'^[-*•\d\.\s]+', '', sentence).strip()


        


        # Strip noise prefixes to get to the core action


        original_sentence = sentence


        for pattern in noise_prefixes:


            sentence = re.sub(pattern, '', sentence, flags=re.IGNORECASE).strip()


            


        if not sentence:


            sentence = original_sentence


            


        # Capitalize first letter if it was stripped


        if sentence:


            sentence = sentence[0].upper() + sentence[1:]


            


        # Avoid duplicate summaries (often models repeat themselves in thought)


        if sentence not in summarized_points:


            summarized_points.append(sentence)





        # Create a tree for the thinking summary





        tree = Tree(blue_gradient_text("🧠 Thinking Process"))





        





        # Define blue style





        blue_style = f"rgb({GRADIENT_BLUE[0]},{GRADIENT_BLUE[1]},{GRADIENT_BLUE[2]})"





        





        if is_streaming:





            # Show only the last 4 points to keep it very tight and "summary-like"





            MAX_STREAM_POINTS = 4





            display_points = summarized_points[-MAX_STREAM_POINTS:] if len(summarized_points) > MAX_STREAM_POINTS else summarized_points





            





            if len(summarized_points) > MAX_STREAM_POINTS:





                tree.add(Text("...", style=blue_style))





                





            for i, point in enumerate(display_points):





                if not point: continue





                # Truncate aggressively





                if len(point) > 80:





                    point = point[:77] + "..."





                





                # The very last point is considered active





                is_active = (i == len(display_points) - 1) and not text.endswith(('.', '!', '?', '\n'))





                





                # Apply blue gradient to the point text





                point_text = blue_gradient_text(f"• {point}")





                if not is_active:





                    point_text.stylize("dim")





                





                tree.add(point_text)





        else:





            # Final summary: show top 3 points





            MAX_FINAL_POINTS = 3





            display_points = summarized_points[:MAX_FINAL_POINTS]





            





            for point in display_points:





                if not point: continue





                if len(point) > 100:





                    point = point[:97] + "..."





                





                # Apply blue gradient to the point text





                point_text = blue_gradient_text(f"• {point}")





                point_text.stylize("dim")





                tree.add(point_text)





                





            if len(summarized_points) > MAX_FINAL_POINTS:





                tree.add(Text("  ...", style=blue_style))





    





        return Panel(tree, border_style=blue_style, expand=False, padding=(0, 1))





    




