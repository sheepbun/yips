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
from rich.console import Group
from rich.cells import cell_len

from cli.color_utils import (
    console,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    GRADIENT_BLUE_DARK,
    TOOL_COLOR,
    PROMPT_COLOR,
    blue_gradient_text,
    blue_pink_gradient_text,
    yellow_blue_gradient_text,
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

        status_text = f" ({time_str})"

        full_text = Text.assemble(
            (self.message, f"dim {color}"),
            (status_text, f"dim {color}")
        )

        self.spinner.text = full_text
        self.spinner.style = color
        return self.spinner


class BootingSpinner(PulsingSpinner):
    """A Spinner that pulses in the PROMPT_COLOR (#FFCCFF)."""
    def __rich__(self) -> Spinner:
        # Simple pulse of opacity or just solid color
        # For now, solid color to match "the same #ffccff pink"
        color = PROMPT_COLOR
        
        full_text = Text(f"{self.message}", style=color)
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


def show_booting(message: str = "Initializing...") -> Live:
    """Create and return a Rich Live context with a booting spinner (#FFCCFF)."""
    return Live(BootingSpinner(message), console=console, transient=True, refresh_per_second=10)


def get_top_border_text(terminal_width: int) -> Text:
    """Generate the top border text with gradient."""
    # For very narrow terminals, use simplified border
    if terminal_width < 25:
        border = "╭" + "─" * max(terminal_width - 2, 0) + "╮"
        top_text = Text()
        for i, char in enumerate(border):
            progress = i / max(len(border) - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            top_text.append(char, style=f"rgb({r},{g},{b})")
        return top_text

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
            return top_text

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

    return top_text


def render_top_border(terminal_width: int) -> None:
    """Render the top border with gradient."""
    console.print(get_top_border_text(terminal_width))


def get_bottom_border_text(terminal_width: int, session_name: str | None = None) -> Text:
    """Generate the bottom border text with gradient."""
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
    
    return bottom_text


def render_bottom_border(terminal_width: int, session_name: str | None = None) -> None:
    """Render the bottom border with gradient, optionally containing session name."""
    console.print(get_bottom_border_text(terminal_width, session_name))


def _add_tool_node_to_tree(tree: Tree, tool_name: str, parameters: dict[str, Any] | str | None, result: str | None = None, is_running: bool = False) -> None:
    """Helper to add a tool node to an existing tree in a concise, project-consistent style."""
    # Strip prefix like (1/4) or ↻ to find the actual tool name for icon selection
    clean_name = re.sub(r"^[↻\s\d\(\)/▶]+", "", tool_name).strip()
    
    icon = "⚙️"
    if "read" in clean_name.lower(): icon = "📖"
    elif "edit" in clean_name.lower(): icon = "✎"
    elif "plan" in clean_name.lower(): icon = "📋"
    elif "write" in clean_name.lower(): icon = "📝"
    elif "command" in clean_name.lower(): icon = "💻"
    elif "skill" in clean_name.lower() or (clean_name.isupper() and len(clean_name) > 1): icon = "⚡"
    elif "identity" in clean_name.lower(): icon = "👤"
    elif "git" in clean_name.lower(): icon = "🐙"
    elif "ls" in clean_name.lower() or "dir" in clean_name.lower(): icon = "📁"
    elif "grep" in clean_name.lower() or "search" in clean_name.lower(): icon = "🔍"
    
    # Build a concise header: Icon Name: Input
    header = Text.assemble((f"{icon} ", ""), (tool_name, f"rgb({GRADIENT_BLUE_DARK[0]},{GRADIENT_BLUE_DARK[1]},{GRADIENT_BLUE_DARK[2]})"))
    
    # Process parameters into a short string - hide redundant keys
    param_str = ""
    if isinstance(parameters, dict):
        if parameters:
            # If there's only one parameter, or specific keys like query/args/command, just show the value
            if len(parameters) == 1:
                param_str = str(next(iter(parameters.values()))).strip()
            else:
                items: list[str] = []
                for k, v in parameters.items():
                    if k.lower() in ('query', 'args', 'command', 'params'):
                        items.append(str(v).strip())
                    else:
                        v_str = str(v).strip()
                        if len(v_str) > 30: v_str = v_str[:27] + "..."
                        items.append(f"{k}={v_str}")
                param_str = ", ".join(items)
    elif parameters:
        param_str = str(parameters).strip()
        # Remove common internal tags from string inputs too
        param_str = re.sub(r"^(query|args|command|params)=\s*", "", param_str, flags=re.IGNORECASE)
        
    if param_str:
        if len(param_str) > 60: param_str = param_str[:57] + "..."
        header.append(f": {param_str}", style="dim")
        
    node = tree.add(header)

    # Status/Result section
    if is_running:
        t = (math.sin(time.time() * 10.0) + 1) / 2
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, t)
        node.add(Text("● Executing...", style=f"rgb({r},{g},{b})"))
    elif result is not None:
        if result == "":
            node.add(Text("✓ Completed", style="dim"))
        else:
            # Truncate result for preview
            res_preview = result.strip()
            
            # Aggressive prefix cleaning
            res_preview = re.sub(r"^\[(?:Command output|File contents|File written|Skill output|stderr|Grep matches|Git output|Sed output|Directory listing).*?\]:?\s*", "", res_preview, flags=re.IGNORECASE)
            
            # Tool-specific relevance logic
            tool_lower = clean_name.lower()
            if "search" in tool_lower:
                title_match = re.search(r"Title: (.*?)(?:\n|$)", res_preview)
                if title_match:
                    res_preview = title_match.group(1).strip()
            elif "read" in tool_lower:
                # Instead of showing contents, show line count or size
                lines = res_preview.splitlines()
                if len(lines) > 1:
                    res_preview = f"Read {len(lines)} lines ({len(result)} bytes)"
                else:
                    res_preview = f"Read {len(result)} bytes"
            elif "ls" in tool_lower or "dir" in tool_lower:
                items = res_preview.splitlines()
                res_preview = f"Found {len(items)} items"
            elif "write" in tool_lower:
                # Keep it simple: "Success" or the brief path
                res_preview = "File saved"
            
            # General cleaning
            cleaned = re.sub(r"^\[.*?\]\s*", "", res_preview)
            if cleaned.strip(): res_preview = cleaned
            
            res_preview = res_preview.replace("\n", " ").strip()
            if len(res_preview) > 100:
                res_preview = res_preview[:97] + "..."
            
            if not res_preview:
                res_preview = "Success"
                
            node.add(Text(f"✓ {res_preview}", style="dim"))


def render_tool_call(tool_name: str, parameters: dict[str, Any] | str, result: str | None = None, is_running: bool = False) -> Panel | dict[str, Any]:
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

    tree = Tree("", hide_root=True)
    _add_tool_node_to_tree(tree, tool_name, parameters, result, is_running)
    return Panel(tree, title=blue_gradient_text("Tool Execution"), border_style=TOOL_COLOR, expand=False, padding=(0, 1))


def render_tool_batch(tools: list[dict[str, Any]], title: str | None = None, compact: bool = False) -> Panel | dict[str, Any]:
    """Render a batch of tools in a single panel. If compact is True, only shows the most recent tool."""
    import os
    if os.environ.get("YIPS_GUI_MODE") == "1":
        return {"type": "batch", "title": title, "tools": tools, "compact": compact}

    title_text = title if title else "Batch Execution"
    tree = Tree("", hide_root=True)
    
    display_tools = tools
    if compact and tools:
        # Only show the most recent tool
        display_tools = [tools[-1]]
        
    for t in display_tools:
        _add_tool_node_to_tree(tree, t['name'], t['params'], t.get('result'), t.get('is_running', False))
    
    return Panel(
        tree,
        title=blue_gradient_text(title_text),
        title_align="left",
        border_style=TOOL_COLOR,
        expand=False,
        padding=(0, 1),
    )


def calculate_optimal_summary_lines(thinking_text: str, is_streaming: bool = False) -> int:
    """
    Calculate optimal number of summary lines based on content.

    Uses character count as primary metric (correlates with complexity),
    adjusted by actual extractable sentence/point count.
    """
    char_count = len(thinking_text.strip())

    # Base calculation from character thresholds
    if char_count < 100:
        base_lines = 2
    elif char_count < 300:
        base_lines = 3
    elif char_count < 600:
        base_lines = 5
    elif char_count < 1000:
        base_lines = 7
    else:
        base_lines = 9

    # Adjust based on actual point extraction
    raw_parts = re.split(r'(?:(?<=[.!?])\s+)|(?:\n+)', thinking_text.strip())
    viable_points = sum(1 for part in raw_parts if len(part.strip()) > 3)

    # If fewer viable points than base, reduce
    if viable_points < base_lines:
        base_lines = max(2, viable_points)

    # If significantly more points, increase slightly (with cap)
    if viable_points > base_lines * 1.5:
        base_lines = min(10, int(base_lines * 1.2))

    # During streaming, show slightly fewer lines (more focused)
    if is_streaming:
        base_lines = max(2, int(base_lines * 0.8))

    return max(2, min(10, base_lines))


def calculate_reading_pause(text: str) -> float:
    """
    Calculate pause time for comfortable reading based on 250 WPM.
    Returns seconds to pause after displaying this text.
    """
    words = len(text.split())
    # ~500 words/min = 8.33 words/sec (skimming speed, not deep reading)
    pause = words / 16.66
    # Clamp: minimum 0.2s, maximum 0.6s
    return max(0.2, min(0.6, pause))


def render_thinking_block(thinking_text: str, is_streaming: bool = False, max_display_lines: int | None = None, visible_lines: int | None = None, show_only_last: bool = False) -> Group:
    """Render a thinking block with manual gradient borders."""
    # Clean up the thinking text
    text = thinking_text.strip()
    if text.startswith("<think>"):
        text = text[7:].strip()
    if text.endswith("</think>"):
        text = text[:-8].strip()

    # Noise patterns to strip
    noise_prefixes = [
        r"^i (will|need to|should|can|am going to|think|believe|want to|'m going to|'m thinking about)\b",
        r"^let's (try to|check|see|look)\b",
        r"^i'll\b",
        r"^now\b",
        r"^first(ly)?,\b",
        r"^second(ly)?,\b",
        r"^third(ly)?,\b",
        r"^then,\b",
        r"^next,\b",
        r"^finally,\b",
        r"^okay,\b",
        r"^so,\b",
        r"^actually,\b",
        r"^it seems (that|like)?\b",
        r"^i should (probably)?\b",
    ]

    # Split into sentences or major lines to identify steps
    raw_parts = re.split(r'(?:(?<=[.!?])\s+)|(?:\n+)', text)
    summarized_points: list[str] = []
    
    # Check if the very last part of the raw text is finished
    last_char = text[-1] if text else ""
    is_text_finished = last_char in ('.', '!', '?', '\n')

    for i, part in enumerate(raw_parts):
        part = part.strip()
        if not part: continue
        
        # If streaming, don't show the very last part if it's not finished yet
        is_last = (i == len(raw_parts) - 1)
        if is_streaming and is_last and not is_text_finished:
            continue

        # Clean markers (bullets, numbers, dots)
        part = re.sub(r'^[-*•\d\.\s]+', '', part).strip()
        
        # Strip common monologue/thought noise
        for pattern in noise_prefixes:
            part = re.sub(pattern, '', part, flags=re.IGNORECASE).strip()
            
        if part:
            # Capitalize and strip trailing colons or unfinished punctuation
            part = part[0].upper() + part[1:]
            part = part.rstrip(':').strip()
            
            if len(part) < 3: continue
            if part not in summarized_points:
                summarized_points.append(part)

    # UI Styles
    # Dynamic display: calculate optimal line count based on content
    if max_display_lines is None:
        max_display_lines = calculate_optimal_summary_lines(text, is_streaming)
    display_points: list[str] = summarized_points[:max_display_lines]

    # For animation: only show subset if specified
    if visible_lines is not None:
        display_points = display_points[:visible_lines]

    # Show only the last (most recent) line
    if show_only_last and display_points:
        display_points = display_points[-1:]
    
    content_lines: list[Text] = []
    if not display_points:
        if not text:
            content_lines.append(yellow_blue_gradient_text("✧ Initializing..."))
        elif is_streaming:
            content_lines.append(yellow_blue_gradient_text("✧ Thinking..."))
        else:
            content_lines.append(yellow_blue_gradient_text("✧ Task analyzed"))
    else:
        for point in display_points:
            content_lines.append(yellow_blue_gradient_text(f"✧ {point}"))

    # Calculate width
    header_plain = "🧠 Thinking Process"
    header_w = cell_len(header_plain)
    term_width = console.width or 80
    max_content_w = max(cell_len(l.plain) for l in content_lines) if content_lines else 0

    # Box needs space for borders (2) and padding (2)
    # For header in border, we need at least ╭─── [header] ───╮ which is header_w + 10
    width = max(max_content_w + 4, header_w + 10)
    width = min(width, term_width - 2)

    # Wrap content lines that exceed the inner width (width - 4 for borders + padding)
    inner_width = width - 4
    wrapped_lines: list[str] = []
    for line in content_lines:
        plain = line.plain
        if cell_len(plain) <= inner_width:
            wrapped_lines.append(plain)
        else:
            # Word-wrap: first line has bullet, continuation lines indented
            words = plain.split(' ')
            current = ""
            for word in words:
                test = f"{current} {word}" if current else word
                if cell_len(test) <= inner_width:
                    current = test
                else:
                    if current:
                        wrapped_lines.append(current)
                    current = f"  {word}"  # indent continuation
            if current:
                wrapped_lines.append(current)
    content_lines = [yellow_blue_gradient_text(l) for l in wrapped_lines]
    
    # Build the box
    renderables: list[Text] = []
    total_rows = 2 + len(content_lines) # top + bottom + content
    
    def get_diag_text(text_str: str, row_idx: int) -> Text:
        styled = Text()
        current_col_cell = 0
        for char in text_str:
            # col_idx relative to total width of box
            # we use cell_len to stay aligned with visual width
            char_w = cell_len(char)
            
            # Progress calculation: (row/total_rows + col/width) / 2
            # Offset col by 1 if it's the left border char, but easier to just use global col
            # Actually, for the text inside, we want to start from col 2 (after "│ ")
            # Let's just use the current_col_cell as a proxy for horizontal progress
            
            # We'll calculate progress for the start of the character
            v_p = row_idx / max(total_rows - 1, 1)
            h_p = current_col_cell / max(width - 1, 1)
            progress = (v_p + h_p) / 2
            
            r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, progress)
            styled.append(char, style=f"rgb({r},{g},{b})")
            current_col_cell += char_w
        return styled

    # 1. Top border with title (row 0)
    opening = "╭─── "
    # Truncate header if box is too narrow (extremely unlikely given width calculation)
    h_plain = header_plain
    if cell_len(opening) + cell_len(h_plain) + 5 > width: # 5 for " ───╮"
        h_plain = h_plain[:width-10] + "..."
        
    top_border_str = opening + h_plain + " "
    remainder = width - cell_len(top_border_str) - 1
    if remainder > 0:
        top_border_str += "─" * remainder
    top_border_str += "╮"
    
    renderables.append(get_diag_text(top_border_str, 0))
    
    # 2. Content rows (rows 1 to len)
    for line_idx, line in enumerate(content_lines):
        row_idx = 1 + line_idx
        row = Text()
        
        # Left border
        r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, (row_idx/max(total_rows-1,1) + 0)/2)
        row.append("│", style=f"rgb({r},{g},{b})")
        row.append(" ")
        
        l_plain = line.plain
        l_len = cell_len(l_plain)

        # Color line content
        for i, char in enumerate(l_plain):
            v_p = row_idx / max(total_rows - 1, 1)
            h_p = (2 + i) / max(width - 1, 1)
            progress = (v_p + h_p) / 2
            r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, progress)
            row.append(char, style=f"rgb({r},{g},{b})")
            
        # Padding
        padding = max(0, width - 4 - l_len)
        row.append(" " * padding)
        
        # Right border (with preceding space)
        v_p = row_idx / max(total_rows - 1, 1)
        # Space before pipe
        h_p_space = (width - 2) / max(width - 1, 1)
        r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, (v_p + h_p_space) / 2)
        row.append(" ", style=f"rgb({r},{g},{b})")
        # Pipe
        h_p_pipe = (width - 1) / max(width - 1, 1)
        r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, (v_p + h_p_pipe) / 2)
        row.append("│", style=f"rgb({r},{g},{b})")
        renderables.append(row)
        
    # 3. Bottom border (last row)
    renderables.append(get_diag_text("╰" + "─" * (width - 2) + "╯", total_rows - 1))
    
    return Group(*renderables)


def render_text_preview(
    file_path: str,
    content: str,
    mode: str = "preview",
    title: str | None = None,
) -> Group:
    """Render a text preview box with blue→pink diagonal gradient.

    Args:
        file_path: Path to display in the header.
        content: The text content to display.
        mode: "preview" for plain content, "diff" for unified diff display.
        title: Optional custom title (defaults to "📝 Text Preview").
    """
    header_plain = title or "📝 Text Preview"
    lines = content.split("\n")
    if mode == "diff" and not lines:
        lines = ["(No changes)"]

    # Build styled content lines
    content_lines: list[tuple[str, str | None]] = []
    # File path sub-header
    content_lines.append((f"  {file_path}", None))
    content_lines.append(("", None))

    for i, line in enumerate(lines):
        if mode == "diff":
            if line.startswith(("--- ", "+++ ")):
                content_lines.append((line, "bold cyan"))
            elif line.startswith("@@ "):
                content_lines.append((line, "cyan"))
            elif line.startswith("+") and not line.startswith("+++ "):
                content_lines.append((line, "green"))
            elif line.startswith("-") and not line.startswith("--- "):
                content_lines.append((line, "red"))
            else:
                content_lines.append((line, None))
        else:
            # Preview mode: show line numbers
            content_lines.append((f" {i + 1:>4} │ {line}", None))

    term_width = console.width or 80

    # Calculate box width
    max_content_w = max((cell_len(l[0]) for l in content_lines), default=0)
    width = max(max_content_w + 4, cell_len(header_plain) + 10)
    width = min(width, term_width - 2)
    inner_width = width - 4

    # Wrap long lines
    wrapped: list[tuple[str, str | None]] = []
    for text_str, style in content_lines:
        if cell_len(text_str) <= inner_width:
            wrapped.append((text_str, style))
        else:
            if inner_width <= 3:
                wrapped.append((text_str[:inner_width], style))
            else:
                wrapped.append((text_str[:inner_width - 3] + "...", style))
    content_lines = wrapped

    total_rows = 2 + len(content_lines)
    renderables: list[Text] = []

    def get_border_text(text_str: str, row_idx: int) -> Text:
        styled = Text()
        for ci, char in enumerate(text_str):
            v_p = row_idx / max(total_rows - 1, 1)
            h_p = ci / max(width - 1, 1)
            progress = (v_p + h_p) / 2
            r, g, b = interpolate_color(GRADIENT_BLUE, GRADIENT_PINK, progress)
            styled.append(char, style=f"rgb({r},{g},{b})")
        return styled

    # Top border
    top = f"╭─── {header_plain} "
    remainder = width - cell_len(top) - 1
    if remainder > 0:
        top += "─" * remainder
    top += "╮"
    renderables.append(get_border_text(top, 0))

    # Content rows
    for line_idx, (line_text, line_style) in enumerate(content_lines):
        row_idx = 1 + line_idx
        row = Text()

        # Left border
        v_p = row_idx / max(total_rows - 1, 1)
        r, g, b = interpolate_color(GRADIENT_BLUE, GRADIENT_PINK, (v_p + 0) / 2)
        row.append("│ ", style=f"rgb({r},{g},{b})")

        # Content
        l_len = cell_len(line_text)
        if line_style:
            row.append(line_text, style=line_style)
        else:
            for ci, char in enumerate(line_text):
                h_p = (2 + ci) / max(width - 1, 1)
                progress = (v_p + h_p) / 2
                r, g, b = interpolate_color(GRADIENT_BLUE, GRADIENT_PINK, progress)
                row.append(char, style=f"rgb({r},{g},{b})")

        # Padding + right border
        padding = max(0, inner_width - l_len)
        row.append(" " * padding)
        h_p_pipe = (width - 1) / max(width - 1, 1)
        r, g, b = interpolate_color(GRADIENT_BLUE, GRADIENT_PINK, (v_p + h_p_pipe) / 2)
        row.append(" │", style=f"rgb({r},{g},{b})")
        renderables.append(row)

    # Bottom border
    renderables.append(get_border_text("╰" + "─" * (width - 2) + "╯", total_rows - 1))

    return Group(*renderables)
