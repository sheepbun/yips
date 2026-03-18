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
    LAYOUT_SINGLE_MIN_WIDTH,
    LAYOUT_COMPACT_MIN_WIDTH,
)
from cli.info_utils import (
    get_username,
    get_recent_activity,
    get_friendly_backend_name,
    get_friendly_model_name,
    get_display_directory,
)
from cli.ui_rendering import (
    generate_yips_logo,
    safe_center,
    render_top_border,
    render_bottom_border,
    get_top_border_text,
    get_bottom_border_text,
    render_thinking_block,
    LOGO_WIDTH,
)
from cli.tool_execution import clean_response

if TYPE_CHECKING:
    from cli.type_defs import YipsAgentProtocol


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
        terminal_width = max(self.console.width, len(status_text))
        padding = " " * max(terminal_width - len(status_text), 0)

        fragments: list[tuple[str, str]] = [("", padding)]
        if not status_text:
            return fragments

        for char in status_text:
            fragments.append(("fg:#89CFF0", char))
        return fragments

    def render_title_box(self: YipsAgentProtocol) -> None:
        """Render the title box with responsive layout."""
        terminal_width = self.console.width
        self.last_width = terminal_width
        layout_mode = self.get_layout_mode(terminal_width)

        if layout_mode == "minimal":
            self.render_minimal_title()
        elif layout_mode in ("compact", "single"):
            self.render_single_column_title(layout_mode)
        else:
            self.console.print(self.get_two_column_title_group())

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

    def render_minimal_title(self: YipsAgentProtocol) -> None:
        """Render minimal title box for very narrow terminals (< 45 chars)."""
        terminal_width = self.console.width
        content_width = terminal_width - 2  # Account for │ borders

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        # Get info
        logo = generate_yips_logo()
        logo_width = len(logo[0]) if logo else 1

        # Determine if we can show the logo (need at least logo width + 2 for borders)
        show_logo = content_width >= LOGO_WIDTH

        # Build minimal content based on available width
        lines = [""]  # blank line

        if show_logo:
            lines.extend(logo)
        else:
            # Show abbreviated "YIPS" text instead
            lines.append("YIPS")

        model_info = self.get_model_info_string()
        lines.append(model_info)
        lines.append("")  # blank line

        logo_height = len(logo) if show_logo else 0

        for line_num, line_text in enumerate(lines):
            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Logo lines (indices 1-6) - only if showing logo
            if show_logo and 1 <= line_num <= 6:
                logo_line_index = line_num - 1
                centered_text = safe_center(line_text, content_width)
                padding_left = (content_width - len(line_text)) // 2 if len(line_text) <= content_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    overall_progress = i / max(content_width - 1, 1)
                    
                    if 0 <= col_index <= logo_width:
                        # Diagonal gradient: Top-Left (Pink) to Bottom-Right (Yellow)
                        vertical_p = logo_line_index / max(logo_height - 1, 1)
                        horizontal_p = col_index / max(logo_width - 1, 1)
                        logo_progress = (vertical_p + horizontal_p) / 2
                        
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, logo_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
                    else:
                        # Padding: extend gradient based on overall position in content_width
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif not show_logo and line_num == 1:
                # Abbreviated "YIPS" text - gradient bold
                centered_text = safe_center(line_text, content_width)
                yips_text = gradient_text(centered_text)
                yips_text.stylize("bold")
                styled_line.append(yips_text)
            elif (show_logo and line_num == 7) or (not show_logo and line_num == 2):
                # Model info - solid blue, truncated if needed
                centered_text = safe_center(line_text, content_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            else:
                styled_line.append(safe_center(line_text, content_width))

            styled_line.append("│", style=right_bar_style)
            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width, self.current_session_name)
        self.console.print()

    def render_single_column_title(self: YipsAgentProtocol, layout_mode: str) -> None:
        """Render single-column title box for narrow terminals (45-79 chars)."""
        terminal_width = self.console.width
        content_width = terminal_width - 2  # Account for │ borders

        # Blank line before title box
        self.console.print()

        # Render top border
        render_top_border(terminal_width)

        # Border styles
        r_left, g_left, b_left = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 0.0)
        left_bar_style = f"rgb({r_left},{g_left},{b_left})"
        r_right, g_right, b_right = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, 1.0)
        right_bar_style = f"rgb({r_right},{g_right},{b_right})"

        # Gather content
        username = get_username()
        cwd = get_display_directory()
        logo = generate_yips_logo()
        logo_width = len(logo[0]) if logo else 1

        # Check if we can show the logo
        show_logo = content_width >= LOGO_WIDTH

        # Build single column content
        welcome_msg = f"Welcome back {username}!" if layout_mode == "single" else f"Hi {username}!"
        lines = [
            "",  # [0] blank
            welcome_msg,  # [1]
            "",  # [2] blank
        ]

        if show_logo:
            lines.extend(logo)  # [3-8] logo lines
            model_info_index = 9
        else:
            lines.append("YIPS")  # [3] abbreviated text
            model_info_index = 4

        lines.append(self.get_model_info_string())  # model info
        cwd_index = len(lines) if layout_mode == "single" else -1
        if layout_mode == "single":
            lines.append(cwd)
        lines.append("")  # blank padding

        logo_height = len(logo) if show_logo else 0

        for line_num, line_text in enumerate(lines):
            styled_line = Text()
            styled_line.append("│", style=left_bar_style)

            # Logo lines (indices 3-8) - only if showing logo
            if show_logo and 3 <= line_num <= 8:
                logo_line_index = line_num - 3
                centered_text = safe_center(line_text, content_width)
                padding_left = (content_width - len(line_text)) // 2 if len(line_text) <= content_width else 0

                for i, char in enumerate(centered_text):
                    col_index = i - padding_left
                    overall_progress = i / max(content_width - 1, 1)
                    
                    if 0 <= col_index <= logo_width:
                        # Diagonal gradient: Top-Left (Pink) to Bottom-Right (Yellow)
                        vertical_p = logo_line_index / max(logo_height - 1, 1)
                        horizontal_p = col_index / max(logo_width - 1, 1)
                        logo_progress = (vertical_p + horizontal_p) / 2
                        
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, logo_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
                    else:
                        # Padding: extend gradient based on overall position in content_width
                        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, overall_progress)
                        styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif not show_logo and line_num == 3:
                # Abbreviated "YIPS" text - gradient bold
                centered_text = safe_center(line_text, content_width)
                yips_text = gradient_text(centered_text)
                yips_text.stylize("bold")
                styled_line.append(yips_text)
            elif line_num == 1:  # Welcome message - gradient, bold
                centered_text = safe_center(line_text, content_width)
                welcome_text = gradient_text(centered_text)
                welcome_text.stylize("bold")
                styled_line.append(welcome_text)
            elif line_num == model_info_index:  # Model info - solid blue
                centered_text = safe_center(line_text, content_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == cwd_index and layout_mode == "single":  # CWD - gradient
                centered_text = safe_center(line_text, content_width)
                cwd_text = gradient_text(centered_text)
                styled_line.append(cwd_text)
            else:
                styled_line.append(safe_center(line_text, content_width))

            styled_line.append("│", style=right_bar_style)
            self.console.print(styled_line)

        # Render bottom border
        render_bottom_border(terminal_width, self.current_session_name)
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
            activity: list[tuple[str, bool]] = []
            for i, s in enumerate(visible_sessions):
                actual_idx = start_idx + i
                is_selected = (actual_idx == self.session_selection_idx)
                prefix = "> " if is_selected else ""
                activity.append((prefix + str(s['display']), is_selected))
        else:
            activity = [(a, False) for a in get_recent_activity()]

        # Build left column (12 lines)
        left_col = [
            "",  # [0] blank
            f"Welcome back {username}!",  # [1]
            "",  # [2] blank
        ]
        left_col.extend(logo)  # [3-8] logo lines (6 lines)
        left_col.append(self.get_model_info_string())  # [9]
        left_col.append(cwd)  # [10]
        left_col.append("")  # [11] blank padding

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
            right_text, is_highlighted = right_item

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
            elif line_num == 9:  # Model info - solid blue
                centered_text = safe_center(left_text, left_width)
                r, g, b = GRADIENT_BLUE
                styled_line.append(centered_text, style=f"rgb({r},{g},{b})")
            elif line_num == 10:  # CWD - gradient
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

            if is_highlighted:
                # Highlighted session: pink bold
                # We need to handle the cursor "> " and separate Timestamp from Title
                prefix_marker = "> "
                full_text = right_text
                
                # Check if we have the expected prefix
                if full_text.startswith(prefix_marker):
                    # Remove prefix for parsing
                    content_text = full_text[len(prefix_marker):]
                    
                    # Split Timestamp and Title
                    # Format: "YYYY-MM-DD @ HH:MM XX: Title"
                    if ": " in content_text:
                        timestamp_part, title_part = content_text.split(": ", 1)
                        timestamp_part += ": "
                    else:
                        timestamp_part = ""
                        title_part = content_text

                    # Construct fixed prefix: "> " + "Timestamp: "
                    full_fixed_prefix = prefix_marker + timestamp_part
                    avail_title_width = right_width - len(full_fixed_prefix)
                    
                    if avail_title_width > 5 and len(title_part) > avail_title_width:
                        # Ping-pong scroll logic for TITLE ONLY
                        limit = len(title_part) - avail_title_width
                        pause = 8 
                        cycle = limit * 2 + pause * 2
                        
                        pos = scroll_step % cycle
                        offset = 0
                        
                        if pos < pause:
                            offset = 0
                        elif pos < pause + limit:
                            offset = pos - pause
                        elif pos < pause + limit + pause:
                            offset = limit
                        else:
                            offset = limit - (pos - (pause + limit + pause))
                            
                        visible_title = title_part[offset : offset + avail_title_width]
                        display_text = full_fixed_prefix + visible_title
                    else:
                        # No scroll needed or too narrow
                        display_text = truncate_right(full_text)
                else:
                    display_text = truncate_right(full_text)

                padded_text = truncate_right(display_text)
                cursor_part = padded_text[:2]
                text_part = padded_text[2:]
                styled_line.append(cursor_part, style="bold #ffccff")
                styled_line.append(text_part, style="bold #ffccff")

            elif line_num == 0:  # Tips header - gradient, bold
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b}) bold")
            elif 1 <= line_num <= 4:  # Commands - gradient
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
                padded_text = truncate_right(right_text)
                for i, char in enumerate(padded_text):
                    char_position = right_col_start_position + i
                    progress = char_position / max(terminal_width - 1, 1)
                    r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
                    styled_line.append(char, style=f"rgb({r},{g},{b})")
            elif line_num == 6:  # Recent activity header - white bold
                styled_line.append(truncate_right(right_text), style="bright_white bold")
            elif line_num >= 7:  # Activity items - dim
                styled_line.append(truncate_right(right_text), style="dim")
            else:
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
                    if thinking_match and self.verbose_mode:
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
        elif width >= LAYOUT_SINGLE_MIN_WIDTH:
            return "single"
        elif width >= LAYOUT_COMPACT_MIN_WIDTH:
            return "compact"
        else:
            return "minimal"

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
