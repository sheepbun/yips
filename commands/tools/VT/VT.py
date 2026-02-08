#!/usr/bin/env python3
"""
VT - Virtual Terminal Skill for Yips

Renders command output in an inline gradient-bordered box
matching the Yips UI style (similar to Thinking Process box).
"""

import os
import sys
import subprocess

from rich.console import Console, Group
from rich.text import Text
from rich.cells import cell_len

# Gradient colors matching Yips theme
GRADIENT_YELLOW = (255, 225, 53)
GRADIENT_BLUE = (137, 207, 240)

console = Console()

# Track current working directory across commands
_cwd: str = os.getcwd()

# Persistent VT output history
_vt_history: list[str] = []
MAX_VT_HISTORY = 20


def get_vt_box_width() -> int:
    """Full terminal width minus 2 for breathing room."""
    return min((console.width or 80) - 2, 200)


def get_display_cwd() -> str:
    """Return display-friendly cwd with ~ substitution."""
    home = os.path.expanduser('~')
    return _cwd.replace(home, '~') if _cwd.startswith(home) else _cwd


def render_vt_top(header: str | None = None, width: int | None = None) -> Text:
    """Render the top border of the VT box."""
    if width is None:
        width = get_vt_box_width()
    if header is None:
        header = f"{get_display_cwd()} VT"
    top_str = "╭─── " + header + " "
    remainder = width - cell_len(top_str) - 1
    if remainder > 0:
        top_str += "─" * remainder
    top_str += "╮"
    top = Text()
    total_rows = max(len(_vt_history) + 3, 3)
    for i, ch in enumerate(top_str):
        _, s = styled_char_static(ch, 0, i, width, total_rows)
        top.append(ch, style=s)
    return top


def render_vt_content_rows(width: int | None = None) -> list[Text]:
    """Render buffered output as gradient-bordered content rows."""
    if width is None:
        width = get_vt_box_width()
    inner_width = width - 4
    total_rows = max(len(_vt_history) + 3, 3)
    rows: list[Text] = []
    for li, line in enumerate(_vt_history):
        row = Text()
        _, ls = styled_char_static("│", 1 + li, 0, width, total_rows)
        row.append("│", style=ls)
        row.append(" ")
        display = line[:inner_width - 1] + "…" if cell_len(line) > inner_width else line
        padded = display + " " * max(0, inner_width - cell_len(display))
        row.append(padded, style="#00ff00")
        row.append(" ")
        _, rs = styled_char_static("│", 1 + li, width - 1, width, total_rows)
        row.append("│", style=rs)
        rows.append(row)
    return rows


def render_vt_bottom(hint: str = "", width: int | None = None) -> Text:
    """Render the bottom border of the VT box."""
    if width is None:
        width = get_vt_box_width()
    total_rows = max(len(_vt_history) + 3, 3)
    bot_str = "╰"
    fill = width - 2 - cell_len(hint)
    left_fill = fill // 2
    right_fill = fill - left_fill
    bot_str += "─" * left_fill + hint + "─" * right_fill + "╯"
    bot = Text()
    for i, ch in enumerate(bot_str):
        _, s = styled_char_static(ch, total_rows - 1, i, width, total_rows)
        bot.append(ch, style=s)
    return bot


def render_vt_bottom_pt(hint: str = "", width: int | None = None) -> list[tuple[str, str]]:
    """Return the bottom border as prompt_toolkit formatted text (style, text) tuples."""
    if width is None:
        width = get_vt_box_width()
    total_rows = max(len(_vt_history) + 3, 3)
    bot_str = "╰"
    fill = width - 2 - cell_len(hint)
    left_fill = fill // 2
    right_fill = fill - left_fill
    bot_str += "─" * left_fill + hint + "─" * right_fill + "╯"
    result: list[tuple[str, str]] = []
    for i, ch in enumerate(bot_str):
        _, s = styled_char_static(ch, total_rows - 1, i, width, total_rows)
        # Convert "rgb(r,g,b)" to "#rrggbb" for prompt_toolkit
        if s.startswith("rgb("):
            parts = s[4:-1].split(",")
            r, g, b = int(parts[0]), int(parts[1]), int(parts[2])
            s = f"#{r:02x}{g:02x}{b:02x}"
        result.append((s, ch))
    return result


def render_vt_prompt_row(width: int | None = None) -> Text:
    """Render a static bash prompt row inside the VT box (for agent mode display)."""
    if width is None:
        width = get_vt_box_width()
    inner_width = width - 4
    total_rows = max(len(_vt_history) + 3, 3)
    row_idx = len(_vt_history) + 1  # after content rows
    row = Text()
    _, ls = styled_char_static("│", row_idx, 0, width, total_rows)
    row.append("│", style=ls)
    row.append(" ")
    prompt_text = f"{get_display_cwd()} $ "
    padded = prompt_text + " " * max(0, inner_width - cell_len(prompt_text))
    row.append(padded, style="#89CFF0")
    row.append(" ")
    _, rs = styled_char_static("│", row_idx, width - 1, width, total_rows)
    row.append("│", style=rs)
    return row


def render_vt_bash_prompt_row(width: int | None = None) -> Text:
    """Render a static bash prompt row with both side borders (for inside the closed box)."""
    if width is None:
        width = get_vt_box_width()
    inner_width = width - 4
    total_rows = max(len(_vt_history) + 3, 3)
    row_idx = len(_vt_history) + 1  # after content rows
    cwd = get_display_cwd()
    prompt_text = f"{cwd} $ "
    padded = prompt_text + " " * max(0, inner_width - cell_len(prompt_text))
    row = Text()
    _, ls = styled_char_static("│", row_idx, 0, width, total_rows)
    row.append("│", style=ls)
    row.append(" ")
    row.append(padded, style="#89CFF0")
    row.append(" ")
    _, rs = styled_char_static("│", row_idx, width - 1, width, total_rows)
    row.append("│", style=rs)
    return row


def get_vt_border_colors(width: int | None = None) -> tuple[str, str]:
    """Return (left_hex, right_hex) colors for the prompt row border position."""
    if width is None:
        width = get_vt_box_width()
    total_rows = max(len(_vt_history) + 3, 3)
    row_idx = len(_vt_history) + 1
    # Compute gradient colors and return as hex for prompt_toolkit compatibility
    lc = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE,
                           (row_idx / max(total_rows - 1, 1)) / 2)
    rc = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE,
                           (row_idx / max(total_rows - 1, 1) + 1.0) / 2)
    return f"#{lc[0]:02x}{lc[1]:02x}{lc[2]:02x}", f"#{rc[0]:02x}{rc[1]:02x}{rc[2]:02x}"



def append_vt_output(command: str, output: str) -> None:
    """Add command output to the VT history buffer."""
    _vt_history.append(f"$ {command}")
    for line in output.split('\n'):
        _vt_history.append(line)
    while len(_vt_history) > MAX_VT_HISTORY:
        _vt_history.pop(0)


def clear_vt_history() -> None:
    """Clear the VT history buffer."""
    _vt_history.clear()


def vt_history_len() -> int:
    """Return the number of lines in VT history."""
    return len(_vt_history)


def has_vt_history() -> bool:
    """Check if VT history has any content."""
    return len(_vt_history) > 0


def interpolate_color(c1: tuple[int,int,int], c2: tuple[int,int,int], t: float) -> tuple[int,int,int]:
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
    )


def is_interactive(command: str) -> bool:
    """Check if a command needs direct TTY access (interactive program)."""
    first_word = command.split()[0] if command.split() else ''
    INTERACTIVE_PROGRAMS = {
        'claude', 'gemini', 'vim', 'nvim', 'nano', 'emacs', 'top', 'htop',
        'btop', 'less', 'more', 'man', 'ssh', 'python', 'python3', 'ipython',
        'node', 'irb', 'bash', 'zsh', 'fish', 'sh',
    }
    return first_word in INTERACTIVE_PROGRAMS


def styled_char_static(char: str, row: int, col: int, width: int, total_rows: int = 3) -> tuple[str, str]:
    """Return (char, rich style string) for gradient-bordered box characters."""
    v_p = row / max(total_rows - 1, 1)
    h_p = col / max(width - 1, 1)
    progress = (v_p + h_p) / 2
    r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, progress)
    return char, f"rgb({r},{g},{b})"


def render_vt_output_rows(output: str, width: int | None = None) -> list[Text]:
    """Render output lines as bordered content rows (for use inside an already-open box)."""
    if width is None:
        width = get_vt_box_width()
    inner_width = width - 4
    lines = output.rstrip('\n').split('\n')
    total_rows = len(lines) + 3  # approximate for gradient
    rows: list[Text] = []
    for li, line in enumerate(lines):
        row = Text()
        _, ls = styled_char_static("│", 1 + li, 0, width, total_rows)
        row.append("│", style=ls)
        row.append(" ")
        display = line[:inner_width - 1] + "…" if cell_len(line) > inner_width else line
        padded = display + " " * max(0, inner_width - cell_len(display))
        row.append(padded, style="#00ff00")
        row.append(" ")
        _, rs = styled_char_static("│", 1 + li, width - 1, width, total_rows)
        row.append("│", style=rs)
        rows.append(row)
    return rows


def render_vt_output_box(command: str, output: str, width: int | None = None) -> Group:
    """Render a single command's output as a complete inline box (like tool output)."""
    if width is None:
        width = get_vt_box_width()
    inner_width = width - 4
    lines = output.rstrip('\n').split('\n')
    total_rows = len(lines) + 2  # top + content + bottom

    # Top border with command as header
    top_str = f"╭─── $ {command} "
    remainder = width - cell_len(top_str) - 1
    if remainder > 0:
        top_str += "─" * remainder
    top_str += "╮"
    top = Text()
    for i, ch in enumerate(top_str):
        _, s = styled_char_static(ch, 0, i, width, total_rows)
        top.append(ch, style=s)

    # Content rows
    content_rows: list[Text] = []
    for li, line in enumerate(lines):
        row = Text()
        _, ls = styled_char_static("│", 1 + li, 0, width, total_rows)
        row.append("│", style=ls)
        row.append(" ")
        display = line[:inner_width - 1] + "…" if cell_len(line) > inner_width else line
        padded = display + " " * max(0, inner_width - cell_len(display))
        row.append(padded, style="#00ff00")
        row.append(" ")
        _, rs = styled_char_static("│", 1 + li, width - 1, width, total_rows)
        row.append("│", style=rs)
        content_rows.append(row)

    # Bottom border
    bot_str = "╰" + "─" * (width - 2) + "╯"
    bot = Text()
    bot_row = total_rows - 1
    for i, ch in enumerate(bot_str):
        _, s = styled_char_static(ch, bot_row, i, width, total_rows)
        bot.append(ch, style=s)

    return Group(top, *content_rows, bot)


def run_interactive(command: str) -> int:
    """Run interactive command with full-width top/bottom borders only."""
    global _cwd

    # Use full terminal width so borders span edge-to-edge
    width = (console.width or 80)
    header = f"{get_display_cwd()} $ {command}"
    console.print(render_vt_top(header, width=width))

    # Run with full TTY — no side borders
    try:
        result = subprocess.run(
            command, shell=True, executable='/bin/bash', cwd=_cwd
        )
        returncode = result.returncode
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        returncode = 1

    console.print(render_vt_bottom(" session ended ", width=width))
    append_vt_output(command, "(interactive session)")
    return returncode


def run_command(command: str) -> str:
    """Execute a command and return combined output. Handles cd specially."""
    global _cwd

    # Handle cd builtin — must change _cwd in-process
    stripped = command.strip()
    if stripped == 'cd' or stripped.startswith('cd '):
        parts = stripped.split(None, 1)
        target = parts[1] if len(parts) > 1 else os.path.expanduser('~')
        target = os.path.expanduser(target)
        try:
            new_dir = os.path.normpath(os.path.join(_cwd, target))
            if os.path.isdir(new_dir):
                _cwd = new_dir
                os.chdir(_cwd)
                return _cwd
            else:
                return f"cd: no such file or directory: {target}"
        except Exception as e:
            return f"cd: {e}"

    try:
        process = subprocess.run(
            command, shell=True, executable='/bin/bash',
            capture_output=True, text=True, cwd=_cwd
        )
        output = process.stdout
        if process.stderr:
            output += process.stderr
        return output.rstrip('\n')
    except Exception as e:
        return f"Error: {e}"


def render_vt_box(command: str, output: str) -> Group:
    """Render command output in a gradient-bordered box."""
    cwd = os.getcwd()
    home = os.path.expanduser('~')
    display_cwd = cwd.replace(home, '~') if cwd.startswith(home) else cwd
    header = f"{display_cwd} $ {command}"

    # Build content lines (always at least one empty line for proper box shape)
    content_lines = output.split('\n') if output else [""]

    # Calculate width
    term_width = console.width or 80
    header_w = cell_len(header)
    hint = " Ctrl+C to quit "
    hint_w = cell_len(hint)
    max_content_w = max((cell_len(l) for l in content_lines), default=0)
    # Ensure box is wide enough for header, content, and bottom hint
    width = max(max_content_w + 4, header_w + 10, hint_w + 4)
    width = min(width, term_width - 2)
    inner_width = width - 4

    # Truncate long lines
    display_lines: list[str] = []
    for line in content_lines:
        if cell_len(line) > inner_width:
            display_lines.append(line[:inner_width - 1] + "…")
        else:
            display_lines.append(line)

    total_rows = 2 + len(display_lines)  # top + content + bottom

    def styled_char(char: str, row: int, col: int) -> tuple[str, str]:
        return styled_char_static(char, row, col, width, total_rows)

    def make_row(content: str, row_idx: int, style: str | None = None) -> Text:
        row = Text()
        _, ls = styled_char("│", row_idx, 0)
        row.append("│", style=ls)
        row.append(" ")

        padded = content + " " * max(0, inner_width - cell_len(content))
        for i, ch in enumerate(padded):
            if style:
                row.append(ch, style=style)
            else:
                _, cs = styled_char(ch, row_idx, 2 + i)
                row.append(ch, style=cs)

        row.append(" ")
        _, rs = styled_char("│", row_idx, width - 1)
        row.append("│", style=rs)
        return row

    renderables: list[Text] = []

    # Top border
    top = Text()
    top_str = "╭─── " + header + " "
    remainder = width - cell_len(top_str) - 1
    if remainder > 0:
        top_str += "─" * remainder
    top_str += "╮"
    for i, ch in enumerate(top_str):
        _, s = styled_char(ch, 0, i)
        top.append(ch, style=s)
    renderables.append(top)

    # Content rows
    for li, line in enumerate(display_lines):
        renderables.append(make_row(line, 1 + li, style="#00ff00"))

    # Bottom border with hint
    bot_str = "╰"
    fill = width - 2 - cell_len(hint)
    left_fill = fill // 2
    right_fill = fill - left_fill
    bot_str += "─" * left_fill + hint + "─" * right_fill + "╯"
    bot = Text()
    for i, ch in enumerate(bot_str):
        _, s = styled_char(ch, total_rows - 1, i)
        bot.append(ch, style=s)
    renderables.append(bot)

    return Group(*renderables)


class VTResult:
    """Result from VTApplication.run()."""
    def __init__(self, type: str, text: str = ""):
        self.type = type  # "agent", "exit", "interactive"
        self.text = text


class VTFrame:
    """Gradient-bordered frame for VT mode using prompt_toolkit containers."""

    def __init__(self, body: 'AnyContainer') -> None:
        from prompt_toolkit.layout.containers import DynamicContainer
        self.body = body
        self.container = DynamicContainer(self._get_container)

    def _get_style(self, row: int, col: int, total_rows: int, total_cols: int) -> str:
        from cli.color_utils import GRADIENT_PINK
        progress = col / max(total_cols - 1, 1)
        r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _get_container(self):
        from prompt_toolkit.layout.containers import HSplit, VSplit, Window
        from prompt_toolkit.layout.controls import FormattedTextControl
        from prompt_toolkit.widgets.base import Border
        from prompt_toolkit.formatted_text import StyleAndTextTuples
        from functools import partial
        from cli.color_utils import GRADIENT_PINK

        total_cols = console.width or 80
        total_rows = max(len(_vt_history) + 4, 5)  # top + history + bash + bottom

        # Title: "Yips Virtual Terminal" — match Model Manager header style
        title_text: StyleAndTextTuples = []
        prefix = "╭─── "
        for i, ch in enumerate(prefix):
            title_text.append((self._get_style(0, i, total_rows, total_cols), ch))

        # "Yips" in pink→yellow gradient
        yips_str = "Yips"
        for i, ch in enumerate(yips_str):
            progress = i / max(len(yips_str) - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            title_text.append((f"#{r:02x}{g:02x}{b:02x}", ch))

        title_text.append((self._get_style(0, len(title_text), total_rows, total_cols), " "))

        # "Virtual Terminal" in blue
        blue_hex = f"#{GRADIENT_BLUE[0]:02x}{GRADIENT_BLUE[1]:02x}{GRADIENT_BLUE[2]:02x}"
        rest = "Virtual Terminal"
        for ch in rest:
            title_text.append((blue_hex, ch))

        title_len = len(title_text)
        title_text.append((self._get_style(0, title_len, total_rows, total_cols), " "))
        title_len += 1

        top_elements = [
            Window(content=FormattedTextControl(title_text), height=1, dont_extend_width=True)
        ]
        remaining = total_cols - title_len - 1
        for i in range(remaining):
            top_elements.append(Window(width=1, height=1, char=Border.HORIZONTAL,
                                       style=partial(self._get_style, 0, title_len + i, total_rows, total_cols)))
        top_elements.append(Window(width=1, height=1, char="╮",
                                    style=partial(self._get_style, 0, total_cols - 1, total_rows, total_cols)))

        # Bottom border
        bottom_elements = [
            Window(width=1, height=1, char="╰",
                   style=partial(self._get_style, total_rows - 1, 0, total_rows, total_cols))
        ]
        for i in range(1, total_cols - 1):
            bottom_elements.append(Window(width=1, height=1, char=Border.HORIZONTAL,
                                          style=partial(self._get_style, total_rows - 1, i, total_rows, total_cols)))
        bottom_elements.append(Window(width=1, height=1, char="╯",
                                       style=partial(self._get_style, total_rows - 1, total_cols - 1, total_rows, total_cols)))

        # Mid-row index for side borders (approximate)
        mid_row = total_rows // 2

        return HSplit([
            VSplit(top_elements, height=1),
            VSplit([
                Window(width=1, char=Border.VERTICAL,
                       style=partial(self._get_style, mid_row, 0, total_rows, total_cols)),
                self.body,
                Window(width=1, char=Border.VERTICAL,
                       style=partial(self._get_style, mid_row, total_cols - 1, total_rows, total_cols)),
            ]),
            VSplit(bottom_elements, height=1),
        ])


class VTApplication:
    """prompt_toolkit Application for VT mode — no ANSI cursor hacks."""

    def __init__(self, agent: object = None) -> None:
        from prompt_toolkit import Application
        from prompt_toolkit.output.color_depth import ColorDepth
        from prompt_toolkit.key_binding import KeyBindings, KeyPressEvent
        from prompt_toolkit.styles import Style
        from prompt_toolkit.layout.containers import HSplit, Window
        from prompt_toolkit.layout.controls import FormattedTextControl
        from prompt_toolkit.layout.layout import Layout
        from prompt_toolkit.widgets import Box, TextArea

        self.agent = agent
        self._result: VTResult | None = None

        # History display
        self.history_window = Window(
            content=FormattedTextControl(self._get_history_text),
            dont_extend_height=True,
        )

        # Bash input TextArea
        self.bash_input = TextArea(
            multiline=False,
            prompt=self._get_bash_prompt,
            style="#89CFF0",
            accept_handler=self._on_bash_submit,
        )

        # Agent input TextArea
        self.agent_input = TextArea(
            multiline=False,
            prompt=[("#ffccff", ">>> ")],
            style="#ffccff",
            accept_handler=self._on_agent_submit,
        )

        # Frame wraps history + bash input
        inner = HSplit([self.history_window, self.bash_input])
        self.frame = VTFrame(inner)

        # Root layout
        root = HSplit([
            self.frame.container,
            self.agent_input,
        ])

        self.layout = Layout(root, focused_element=self.bash_input)

        # Key bindings
        self.kb = KeyBindings()

        @self.kb.add('s-tab')
        def _(event: KeyPressEvent) -> None:
            if self.layout.has_focus(self.bash_input):
                self.layout.focus(self.agent_input)
            else:
                self.layout.focus(self.bash_input)

        @self.kb.add('tab')
        def _(event: KeyPressEvent) -> None:
            if self.layout.has_focus(self.bash_input):
                self.layout.focus(self.agent_input)
            else:
                self.layout.focus(self.bash_input)

        @self.kb.add('escape')
        def _(event: KeyPressEvent) -> None:
            self._result = VTResult("exit")
            event.app.exit()

        @self.kb.add('c-c')
        def _(event: KeyPressEvent) -> None:
            self._result = VTResult("exit")
            event.app.exit()

        vt_style = Style.from_dict({
            '': '',
            'bottom-toolbar': 'noinherit noreverse',
        })

        self.app: Application = Application(
            layout=self.layout,
            key_bindings=self.kb,
            style=vt_style,
            full_screen=False,
            color_depth=ColorDepth.TRUE_COLOR,
        )

    def _get_bash_prompt(self):
        return [("#89CFF0", f"{get_display_cwd()} $ ")]

    def _get_history_text(self):
        from prompt_toolkit.formatted_text import FormattedText
        parts = []
        for line in _vt_history:
            parts.append(("#ffffff", line + "\n"))
        return FormattedText(parts) if parts else FormattedText([("", "")])

    def _on_bash_submit(self, buff) -> None:
        command = buff.text.strip()
        if not command:
            return

        if is_interactive(command):
            self._result = VTResult("interactive", command)
            self.app.exit()
            return

        output = run_command(command)
        append_vt_output(command, output)
        # Invalidate to re-render with new history
        self.app.invalidate()

    def _on_agent_submit(self, buff) -> None:
        text = buff.text.strip()
        if not text:
            return
        self._result = VTResult("agent", text)
        self.app.exit()

    def run(self) -> VTResult:
        """Run the VT application. Returns VTResult."""
        self._result = None
        self.app.run()
        return self._result or VTResult("exit")


def main(initial_command: str | None = None):
    """Run the Virtual Terminal inline (execute initial_command and return)."""

    if initial_command:
        output = run_command(initial_command)
        console.print(render_vt_box(initial_command, output))


if __name__ == "__main__":
    cmd = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else None
    main(initial_command=cmd)
