"UI rendering and display management for YipsAgent."

from __future__ import annotations

import os
import re
import subprocess
import time
import json
from typing import TYPE_CHECKING, Any
from rich.text import Text
from rich.live import Live
from rich.console import Group

from cli.color_utils import (
    gradient_text,
    apply_gradient_to_text,
    get_yips_prefix,
    interpolate_color,
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    TOOL_COLOR,
)
from cli.config import (
    LAYOUT_FULL_MIN_WIDTH,
    APP_VERSION,
)
from cli.info_utils import (
    get_username,
    get_recent_activity_items,
    get_friendly_backend_name,
    get_friendly_model_name,
    get_display_directory,
)
from cli.ui_rendering import (
    generate_yips_logo,
    safe_center,
    get_top_border_text,
    get_bottom_border_text,
    render_thinking_block,
    LOGO_WIDTH,
)
from cli.tool_execution import clean_response

if TYPE_CHECKING:
    from cli.type_defs import YipsAgentProtocol


def _wrap_model_info_lines(model_info: str, content_width: int) -> list[str]:
    """Split model info across two lines if it exceeds content_width.

    Splits on the last ' · ' separator so the token count falls onto a
    second line, keeping the backend/model name together on the first.
    """
    if len(model_info) <= content_width:
        return [model_info]
    parts = model_info.split(' · ')
    if len(parts) < 2:
        return [model_info]
    line1 = ' · '.join(parts[:-1])
    line2 = parts[-1]
    return [line1, line2]


def _truncate_text(value: str, width: int) -> str:
    if width <= 0:
        return ""
    if len(value) > width:
        return value[:width]
    return value.ljust(width)


def _scroll_title(title: str, visible_width: int, scroll_step: int) -> str:
    if visible_width <= 0:
        return ""
    if len(title) <= visible_width or visible_width <= 5:
        return title[:visible_width].ljust(visible_width)

    limit = len(title) - visible_width
    pause = 8
    cycle = limit * 2 + pause * 2
    pos = scroll_step % cycle

    if pos < pause:
        offset = 0
    elif pos < pause + limit:
        offset = pos - pause
    elif pos < pause + limit + pause:
        offset = limit
    else:
        offset = limit - (pos - (pause + limit + pause))

    return title[offset : offset + visible_width]


def _build_activity_text(
    timestamp: str,
    prefix: str,
    title: str,
    width: int,
    *,
    prefix_color: str | None = None,
    highlighted: bool = False,
    selected: bool = False,
    scroll_step: int = 0,
) -> Text:
    row = Text()

    if selected:
        row.append("> ", style="bold #ffccff")
        base_style = "bold #ffccff"
    else:
        base_style = "dim" if not highlighted else "bold #ffccff"

    static_parts: list[tuple[str, str]] = []
    if timestamp:
        static_parts.append((f"{timestamp}: ", base_style))
    if prefix:
        static_parts.append((prefix, base_style if highlighted else (prefix_color or base_style)))

    remaining_width = max(width - len(row.plain), 0)
    static_width = sum(len(text) for text, _ in static_parts)
    if static_width >= remaining_width:
        consumed = 0
        for text, style in static_parts:
            visible = _truncate_text(text, max(remaining_width - consumed, 0))
            if visible:
                row.append(visible, style=style)
                consumed += len(visible)
            if consumed >= remaining_width:
                return row

    for text, style in static_parts:
        row.append(text, style=style)

    title_width = max(width - len(row.plain), 0)
    visible_title = _scroll_title(title, title_width, scroll_step) if highlighted else _truncate_text(title, title_width)

    row.append(visible_title, style=base_style)

    return row


class AgentUIMixin:
    """Mixin providing UI rendering capabilities to YipsAgent."""

    def format_stream_status(self: YipsAgentProtocol, tps: float | None) -> str:
        """Format the prompt status text for the most recent streamed response."""
        if tps is None or tps <= 0:
            return ""
        return f"{tps:.1f} tk/s"

    def update_stream_status(self: YipsAgentProtocol, output_tokens: int | None, duration_seconds: float) -> None:
        """Store throughput from the last successful streamed response."""
        if output_tokens is None or output_tokens <= 0 or duration_seconds <= 0:
            return
        self.last_stream_tps = output_tokens / duration_seconds
        self.last_stream_status_text = self.format_stream_status(self.last_stream_tps)

    def get_prompt_status_fragments(self: YipsAgentProtocol) -> list[tuple[str, str]]:
        """Build a right-aligned status line shown directly under the >>> prompt."""
        status_text = getattr(self, "last_stream_status_text", "")
        terminal_width = self.console.width
        # Subtract 1 to avoid the terminal's last column, which prompt_toolkit reserves
        # to prevent cursor wrap - without this the last character gets clipped
        padding_count = max(terminal_width - len(status_text) - 1, 0)

        # Build fragments with padding and styled text
        fragments: list[tuple[str, str]] = []
        if padding_count > 0:
            fragments.append(("", " " * padding_count))

        if status_text:
            fragments.append(("fg:#89CFF0", status_text))

        return fragments if fragments else [("", "")]

    def render_title_box(self: YipsAgentProtocol) -> None:
        """Render the title box with responsive layout."""
        terminal_width = self.console.width
        self.last_width = terminal_width

        if terminal_width >= LAYOUT_FULL_MIN_WIDTH:
            self.console.print(self.get_two_column_title_group())
        else:
            self.render_compact_title_bar()

    def get_title_box_group(self: YipsAgentProtocol, scroll_offset: int = 0) -> Group:
        """Get the title box renderable group (mostly for animation)."""
        return self.get_two_column_title_group(scroll_offset)

    def get_model_info_string(self: YipsAgentProtocol) -> str:
        """Generate the model info string with context size if available."""
        backend_key = "claude" if getattr(self, 'use_claude_cli', False) else self.backend
        display_backend = get_friendly_backend_name(backend_key)
        display_model = get_friendly_model_name(self.current_model)
        
        info = f"{display_backend} · {display_model}"
        
        # Prefer token_limits (dynamic, RAM-based) over context_size (llama.cpp)
        max_tok = None
        if hasattr(self, 'token_limits') and self.token_limits:
            max_tok = self.token_limits.get('max_tokens')
        if not max_tok:
            max_tok = getattr(self, 'context_size', None)
        if max_tok:
            ctx_str = f"{max_tok / 1000:.1f}k"
            # Show current usage if conversation exists
            used = 0
            if hasattr(self, 'conversation_history') and self.conversation_history:
                used = self.estimate_tokens("", self.conversation_history)
                if hasattr(self, 'running_summary') and self.running_summary:
                    used += len(self.running_summary) // 3
            if used > 0:
                if used >= 1000:
                    used_str = f"{used / 1000:.1f}k"
                else:
                    used_str = str(used)
                info += f" · {used_str}/{ctx_str} tokens"
            else:
                info += f" · {ctx_str} tokens"
            
        return info

    def render_compact_title_bar(self: YipsAgentProtocol) -> None:
        """Render a borderless 4-line compact title bar for terminals narrower than the full layout."""
        terminal_width = self.console.width

        mini_logo = [
            " \u259b\u2596\u2571\u2572\u2597\u259c",
            " \u2599\u259f\u259c\u259b\u2599\u259f",
            " \u259c\u259e\u259a\u259e\u259a\u259b",
            "  \u2580\u2580\u2580\u2580 ",
        ]
        logo_col_width = 7
        logo_rows = len(mini_logo)
        gap = "   "
        text_width = max(terminal_width - logo_col_width - len(gap), 0)

        title_text = "Yips CLI"
        version_text = APP_VERSION
        row_texts: list[str | None] = [
            f"{title_text} {version_text}"[:text_width] if text_width else "",
            self.get_model_info_string()[:text_width] if text_width else "",
            get_display_directory()[:text_width] if text_width else "",
            None,
        ]

        self.console.print()

        for row_idx, logo_row in enumerate(mini_logo):
            styled_line = Text()

            for col_idx, char in enumerate(logo_row):
                if char == " ":
                    styled_line.append(char)
                    continue
                vertical_p = row_idx / max(logo_rows - 1, 1)
                horizontal_p = col_idx / max(logo_col_width - 1, 1)
                t = (vertical_p + horizontal_p) / 2
                r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, t)
                styled_line.append(char, style=f"rgb({r},{g},{b})")

            styled_line.append(gap)

            row_text = row_texts[row_idx]
            if not row_text:
                self.console.print(styled_line)
                continue

            if row_idx == 0:
                if len(row_text) >= len(title_text) + 1:
                    styled_line.append_text(gradient_text(title_text))
                    remainder = row_text[len(title_text):]
                    styled_line.append(remainder[0])
                    version_part = remainder[1:]
                    if version_part:
                        r, g, b = GRADIENT_BLUE
                        styled_line.append(version_part, style=f"rgb({r},{g},{b})")
                else:
                    styled_line.append_text(gradient_text(row_text))
            elif row_idx == 1:
                r, g, b = GRADIENT_BLUE
                styled_line.append(row_text, style=f"rgb({r},{g},{b})")
            elif row_idx == 2:
                styled_line.append_text(gradient_text(row_text))

            self.console.print(styled_line)

        self.console.print()

    def get_two_column_title_group(self: YipsAgentProtocol, scroll_step: int = 0) -> Group:
        """Generate two-column title box group (for wide terminals >= 80 chars)."""
        terminal_width = self.console.width

        # If logo width exceeds 50% of terminal, hide right column (render single-column)
        # We can't easily return a single column group yet if we are in this method, 
        # but we can try. Ideally caller checks this, but we'll handle it gracefully.
        if LOGO_WIDTH > terminal_width * 0.5:
            # Fallback for now: capture output or return empty?
            # Since get_title_box_group calls this, and we promised to return a Group...
            # We'll just return a simplified single column text block for now.
            return Group(Text("Terminal too narrow for 2-column view"))

        # Reserve space for borders and divider: │ + left + │ + right + │
        available_width = terminal_width - 3
        left_width = max(int(available_width * 0.45), 30)
        right_width = available_width - left_width

        # Gather content
        username = get_username()
        cwd = get_display_directory()
        logo = generate_yips_logo()
        logo_height = len(logo)
        logo_width = len(logo[0]) if logo else 1
        
        if getattr(self, 'session_selection_active', False):
            # Show interactive session list in the right column
            # We have about 5-6 slots depending on layout
            max_slots = 5
            start_idx = max(0, min(self.session_selection_idx - max_slots // 2, len(self.session_list) - max_slots))
            visible_sessions = self.session_list[start_idx : start_idx + max_slots]
            activity: list[dict[str, Any]] = []
            for i, s in enumerate(visible_sessions):
                actual_idx = start_idx + i
                is_selected = (actual_idx == self.session_selection_idx)
                activity.append(
                    {
                        "timestamp": str(s.get("timestamp", "")),
                        "prefix": str(s.get("display_prefix", "")),
                        "title": str(s.get("display_title", "")),
                        "prefix_color": s.get("prefix_color"),
                        "selected": is_selected,
                    }
                )
        else:
            activity = [
                {
                    "timestamp": item.display_time,
                    "prefix": item.prefix,
                    "title": item.title,
                    "prefix_color": item.prefix_color,
                    "selected": False,
                }
                for item in get_recent_activity_items()
            ]
            if not activity:
                activity = [
                    {
                        "timestamp": "",
                        "prefix": "",
                        "title": "No recent activity",
                        "prefix_color": None,
                        "selected": False,
                    }
                ]

        # Build left column (12 lines)
        left_col = [
            "",  # [0] blank
            f"Welcome back {username}!",  # [1]
            "",  # [2] blank
        ]
        left_col.extend(logo)  # [3-8] logo lines (6 lines)
        model_info_start_idx = len(left_col)  # 9
        model_info_lines_list = _wrap_model_info_lines(self.get_model_info_string(), left_width)
        left_col.extend(model_info_lines_list)  # [9] or [9-10]
        model_info_end_idx = len(left_col)  # 10 or 11
        cwd_idx = len(left_col)
        left_col.append(cwd)  # [10] or [11]
        left_col.append("")  # [11] or [12] blank padding

        # Build right column
        right_col_data = [
            ("Tips for getting started:", False),  # [0]
            ("- Ask questions, edit files, or run commands.", False),  # [1]
            ("- Be specific for the best results.", False),  # [2]
            ("- /help for more information.", False),  # [3]
            ("", False),  # [4]
            ("─" * right_width, False),  # [5] divider
            ("Recent activity", False),  # [6]
        ]
        right_col_data.extend(activity)
        
        while len(right_col_data) < len(left_col):
            right_col_data.append(("", False))

        renderables: list[Any] = []
        renderables.append(Text("")) # Blank line

        # Top border
        renderables.append(get_top_border_text(terminal_width))

        # Render content lines
        max_lines = max(len(left_col), len(right_col_data))

        # Calculate border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"

        middle_progress = (left_width + 1) / max(terminal_width - 1, 1)
        r_mid, g_mid, b_mid = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, middle_progress)
        divider_style = f"rgb({r_mid},{g_mid},{b_mid})"

        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        for line_num in range(max_lines):
            left_text = left_col[line_num] if line_num < len(left_col) else ""
            right_item = right_col_data[line_num] if line_num < len(right_col_data) else ("", False)

            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Left content with proper styling
            if line_num >= 3 and line_num <= 8:  # Logo lines - raster scan gradient
                logo_line_index = line_num - 3
                centered_text = safe_center(left_text, left_width)
                padding_left = (left_width - len(left_text)) // 2 if len(left_text) <= left_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    overall_progress = i / max(left_width - 1, 1)

                    if 0 <= col_index <= logo_width:  # Allow equal to handle edge cases
                        # Diagonal gradient: Top-Left (Pink) to Bottom-Right (Yellow)
                        vertical_p = logo_line_index / max(logo_height - 1, 1)
                        horizontal_p = col_index / max(logo_width - 1, 1)
                        logo_progress = (vertical_p + horizontal_p) / 2
                        
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, logo_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
                    else:
                        # Padding: extend gradient based on overall position in left_width
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 1:  # Welcome message - gradient, bold
                centered_text = safe_center(left_text, left_width)
                welcome_text = gradient_text(centered_text)
                welcome_text.stylize("bold")
                styled_line.append(welcome_text)
            elif model_info_start_idx <= line_num < model_info_end_idx:  # Model info - solid blue
                centered_text = safe_center(left_text, left_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == cwd_idx:  # CWD - gradient
                centered_text = safe_center(left_text, left_width)
                cwd_text = gradient_text(centered_text)
                styled_line.append(cwd_text)
            else:
                centered_text = safe_center(left_text, left_width)
                styled_line.append(centered_text)

            # Divider bar
            styled_line.append("│", style=divider_style)

            # Right content with styling
            def truncate_right(text: str) -> str:
                if len(text) > right_width:
                    return text[:right_width]
                return text.ljust(right_width)

            right_col_start_position = left_width + 2

            if isinstance(right_item, dict):
                styled_line.append(
                    _build_activity_text(
                        str(right_item.get("timestamp", "")),
                        str(right_item.get("prefix", "")),
                        str(right_item.get("title", "")),
                        right_width,
                        prefix_color=right_item.get("prefix_color"),
                        highlighted=bool(right_item.get("selected")),
                        selected=bool(right_item.get("selected")),
                        scroll_step=scroll_step,
                    )
                )
            elif line_num == 0:  # Tips header - gradient, bold
                right_text = right_item[0]
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b}) bold")
            elif 1 <= line_num <= 4:  # Commands - gradient
                right_text = right_item[0]
                padded_text = truncate_right(right_text)
                # Match /command (starts with / followed by letters)
                command_match = re.search(r'(/[a-z]+)', padded_text)
                command_range = command_match.span() if command_match else (-1, -1)

                for i, char in enumerate(padded_text):
                    if command_range[0] <= i < command_range[1]:
                        # Commands in pink
                        styled_line.append(char, style="#ffccff")
                    else:
                        # Rest of the description with gradient
                        char_position = right_col_start_position + i
                        progress = char_position / max(terminal_width - 1, 1)
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 5:  # Divider line - gradient
                right_text = right_item[0]
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 6:  # Recent activity header - white bold
                right_text = right_item[0]
                styled_line.append(truncate_right(right_text), style="bright_white bold")
            elif line_num >= 7:  # Activity items - dim
                right_text = right_item[0]
                styled_line.append(truncate_right(right_text), style="dim")
            else:
                right_text = right_item[0]
                styled_line.append(truncate_right(right_text))

            # Right bar
            styled_line.append("│", style=right_bar_style)

            renderables.append(styled_line)

        # Bottom border
        renderables.append(get_bottom_border_text(terminal_width, self.current_session_name))
        renderables.append(Text("")) # Trailing newline matching print() behavior

        return Group(*renderables)

    def refresh_display(self: YipsAgentProtocol) -> None:
        """Clear terminal and re-render title box and history."""
        subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
        self.render_title_box()
        self.replay_conversation_history()

    def replay_conversation_history(self: YipsAgentProtocol) -> None:
        """Re-render all messages from conversation_history to screen."""
        from cli.color_utils import print_yips, PROMPT_COLOR
        from cli.config import INTERNAL_REPROMPT

        if not hasattr(self, 'conversation_history'):
            return

        # Index to keep track of processed messages
        idx = 0
        history_len = len(self.conversation_history)
        while idx < history_len:
            message = self.conversation_history[idx]
            role = message.get("role")
            content = message.get("content", "")

            if role == "user":
                if content != INTERNAL_REPROMPT:
                    self.console.print(f">>> {content}", style=PROMPT_COLOR)
                idx += 1
            elif role == "assistant":
                if content:
                    thinking_match = re.search(r"<think>(.*?)</think>", content, re.DOTALL)
                    if thinking_match:
                        thinking_content = thinking_match.group(1).strip()
                        if thinking_content:
                            self.console.print(render_thinking_block(thinking_content))
                    
                    cleaned_content = clean_response(content)
                    if cleaned_content:
                        print_yips(cleaned_content)
                idx += 1
            elif role == "system":
                # Look ahead to group consecutive tool calls
                tool_batch: list[dict[str, Any]] = []
                while idx < history_len:
                    msg = self.conversation_history[idx]
                    if msg.get("role") != "system":
                        break
                    
                    msg_content = msg.get("content", "")
                    try:
                        if msg_content.startswith('{') and msg_content.endswith('}'):
                            data = json.loads(msg_content)
                            if "tool" in data and "result" in data:
                                tool_batch.append({
                                    "name": data.get("tool", "unknown"),
                                    "params": data.get("params", ""),
                                    "result": data.get("result", "")
                                })
                                idx += 1
                                continue
                    except:
                        pass
                    
                    # If not a tool call, process normally and break batch
                    if not tool_batch:
                        if msg_content:
                            self.console.print(msg_content, style=TOOL_COLOR)
                        idx += 1
                    break
                
                if tool_batch:
                    from cli.ui_rendering import render_tool_batch
                    summary = f"⚡ Executed {len(tool_batch)} tool call{'s' if len(tool_batch) != 1 else ''}"
                    self.console.print(render_tool_batch(tool_batch, summary))

            # Turn spacing: Only add a blank line if the NEXT message is a REAL user prompt
            if idx < history_len:
                next_msg = self.conversation_history[idx]
                if next_msg.get("role") == "user" and next_msg.get("content") != INTERNAL_REPROMPT:
                    self.console.print()
        
        # Ensure a final newline before the interactive prompt
        if history_len > 0:
            self.console.print()

    def refresh_title_box_only(self: YipsAgentProtocol) -> None:
        """Re-render the title box and conversation history."""
        if getattr(self, 'prompt_session', None) is not None:
            try:
                from prompt_toolkit.application import get_app
                subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
                self.render_title_box()
                self.replay_conversation_history()
                app = get_app()
                app.invalidate()
            except Exception:
                subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
                self.render_title_box()
                self.replay_conversation_history()
        else:
            subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
            self.render_title_box()
            self.replay_conversation_history()

    def get_layout_mode(self: YipsAgentProtocol, width: int) -> str:
        """Determine layout mode based on terminal width."""
        if width >= LAYOUT_FULL_MIN_WIDTH:
            return "full"
        return "bar"

    def stream_text(self: YipsAgentProtocol, text: str) -> None:
        """Simulate streaming for a static piece of text."""
        prefix = get_yips_prefix()
        indent = " " * len(prefix)

        accumulated = ""
        with Live("", console=self.console, refresh_per_second=20, transient=True) as live:
            for char in text:
                accumulated += char
                display_text = Text()
                display_text.append_text(prefix)
                lines = accumulated.split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        display_text.append("\n" + indent)
                    display_text.append(apply_gradient_to_text(line))
                live.update(display_text)
                time.sleep(0.02)

        self.console.print(prefix, end="")
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if i > 0:
                self.console.print("\n" + indent, end="")
            self.console.print(gradient_text(line), end="")
        self.console.print()
