#!/usr/bin/env python3
"""
VT - Virtual Terminal Skill for Yips

Persistent PTY terminal emulator rendered inside a gradient-bordered box.
A single bash shell session persists across VT mode toggles.
"""

import os
import sys
import pty
import select
import signal
import struct
import fcntl

import pyte
from rich.console import Console
from rich.text import Text
from rich.cells import cell_len

# Gradient colors matching Yips theme
GRADIENT_YELLOW = (255, 225, 53)
GRADIENT_BLUE = (137, 207, 240)

console = Console()

# ---------------------------------------------------------------------------
# PersistentPTY — singleton bash shell
# ---------------------------------------------------------------------------

MAX_VISIBLE_LINES = 20


class PatchedScreen(pyte.Screen):
    """pyte.Screen subclass that tolerates extra kwargs in methods like SGR."""
    def select_graphic_rendition(self, *args, **kwargs):
        super().select_graphic_rendition(*args)

    def set_mode(self, *args, **kwargs):
        super().set_mode(*args, **kwargs)

    def reset_mode(self, *args, **kwargs):
        super().reset_mode(*args, **kwargs)


class PersistentPTY:
    """A persistent bash shell with a pyte virtual-terminal backend."""

    def __init__(self, cols: int = 80, rows: int = 24) -> None:
        self.cols = cols
        self.rows = rows
        self.screen = PatchedScreen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)
        self.master_fd: int = -1
        self.child_pid: int = -1

    def spawn(self) -> None:
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"

        master, slave = pty.openpty()
        winsize = struct.pack('HHHH', self.rows, self.cols, 0, 0)
        fcntl.ioctl(slave, __import__('termios').TIOCSWINSZ, winsize)

        pid = os.fork()
        if pid == 0:  # child
            os.setsid()
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            os.dup2(slave, 2)
            os.close(master)
            os.close(slave)
            os.execvpe('/bin/bash', ['bash', '-i'], env)

        os.close(slave)
        self.master_fd = master
        self.child_pid = pid

    def write(self, data: bytes) -> None:
        if self.master_fd >= 0:
            os.write(self.master_fd, data)

    def read(self) -> bool:
        """Non-blocking read from PTY. Returns True if data arrived."""
        if self.master_fd < 0:
            return False
        try:
            rlist, _, _ = select.select([self.master_fd], [], [], 0)
            if self.master_fd in rlist:
                data = os.read(self.master_fd, 65536)
                if data:
                    # Filter out Kitty keyboard protocol sequences (CSI < ... u)
                    # which pyte incorrectly parses, leading to leaked 'u' characters.
                    import re
                    data = re.sub(b'\x1b\\[<[\\d;]*u', b'', data)
                    self.stream.feed(data)
                    return True
        except OSError:
            pass
        return False

    def resize(self, cols: int, rows: int) -> None:
        self.cols = cols
        self.rows = rows
        self.screen.resize(rows, cols)
        if self.master_fd >= 0:
            import termios
            winsize = struct.pack('HHHH', rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            if self.is_alive():
                try:
                    os.kill(self.child_pid, signal.SIGWINCH)
                except ProcessLookupError:
                    pass

    def is_alive(self) -> bool:
        if self.child_pid < 0:
            return False
        try:
            pid, _ = os.waitpid(self.child_pid, os.WNOHANG)
            return pid == 0
        except ChildProcessError:
            return False

    def kill(self) -> None:
        if self.child_pid > 0 and self.is_alive():
            try:
                os.kill(self.child_pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        if self.master_fd >= 0:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = -1
        self.child_pid = -1

    def get_display(self) -> list[str]:
        return list(self.screen.display)

    def get_cursor(self) -> tuple[int, int]:
        return (self.screen.cursor.y, self.screen.cursor.x)


# ---------------------------------------------------------------------------
# Module-level singleton management
# ---------------------------------------------------------------------------

_pty_session: PersistentPTY | None = None


def get_pty_session() -> PersistentPTY:
    """Get or create the persistent PTY session, respawning if dead."""
    global _pty_session
    if _pty_session is None or not _pty_session.is_alive():
        if _pty_session is not None:
            _pty_session.kill()
        cols = max((console.width or 80) - 4, 40)
        rows = max((os.get_terminal_size().lines if sys.stdout.isatty() else 24) - 4, 10)
        _pty_session = PersistentPTY(cols=cols, rows=rows)
        _pty_session.spawn()
    return _pty_session


def kill_pty_session() -> None:
    """Kill the persistent PTY session (for cleanup on exit)."""
    global _pty_session
    if _pty_session is not None:
        _pty_session.kill()
        _pty_session = None


def get_visible_lines(max_lines: int = MAX_VISIBLE_LINES) -> list[str]:
    """Get the last N non-blank lines from the pyte screen."""
    if _pty_session is None or not _pty_session.is_alive():
        return []
    display = _pty_session.get_display()
    # Find last non-blank line
    last_nonblank = -1
    for i in range(len(display) - 1, -1, -1):
        if display[i].rstrip():
            last_nonblank = i
            break
    if last_nonblank < 0:
        return []
    # Return up to max_lines ending at last_nonblank
    start = max(0, last_nonblank - max_lines + 1)
    return [display[i] for i in range(start, last_nonblank + 1)]


# ---------------------------------------------------------------------------
# Gradient helpers (shared between VT box rendering and VTApplication)
# ---------------------------------------------------------------------------

def interpolate_color(c1: tuple[int,int,int], c2: tuple[int,int,int], t: float) -> tuple[int,int,int]:
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
    )


def styled_char_static(char: str, row: int, col: int, width: int, total_rows: int = 3) -> tuple[str, str]:
    """Return (char, rich style string) for gradient-bordered box characters."""
    v_p = row / max(total_rows - 1, 1)
    h_p = col / max(width - 1, 1)
    progress = (v_p + h_p) / 2
    r, g, b = interpolate_color(GRADIENT_YELLOW, GRADIENT_BLUE, progress)
    return char, f"rgb({r},{g},{b})"


def get_vt_box_width() -> int:
    """Full terminal width minus 2 for breathing room."""
    return min((console.width or 80) - 2, 200)


# ---------------------------------------------------------------------------
# Agent-mode closed box rendering (uses pyte screen content)
# ---------------------------------------------------------------------------

def vt_history_len() -> int:
    """Return the number of visible lines from the PTY."""
    return len(get_visible_lines())


def has_vt_history() -> bool:
    """Check if PTY session is alive and has content."""
    return _pty_session is not None and _pty_session.is_alive() and vt_history_len() > 0


def render_vt_top(header: str | None = None, width: int | None = None) -> Text:
    """Render the top border of the VT box."""
    if width is None:
        width = get_vt_box_width()
    lines = get_visible_lines()
    if header is None:
        header = "VT"
    top_str = "╭─── " + header + " "
    remainder = width - cell_len(top_str) - 1
    if remainder > 0:
        top_str += "─" * remainder
    top_str += "╮"
    top = Text()
    total_rows = max(len(lines) + 2, 3)
    for i, ch in enumerate(top_str):
        _, s = styled_char_static(ch, 0, i, width, total_rows)
        top.append(ch, style=s)
    return top


def render_vt_content_rows(width: int | None = None) -> list[Text]:
    """Render PTY screen lines as gradient-bordered content rows."""
    if width is None:
        width = get_vt_box_width()
    inner_width = width - 4
    lines = get_visible_lines()
    total_rows = max(len(lines) + 2, 3)
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


def render_vt_bottom(hint: str = "", width: int | None = None) -> Text:
    """Render the bottom border of the VT box."""
    if width is None:
        width = get_vt_box_width()
    lines = get_visible_lines()
    total_rows = max(len(lines) + 2, 3)
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



# ---------------------------------------------------------------------------
# VTResult
# ---------------------------------------------------------------------------

class VTResult:
    """Result from VTApplication.run()."""
    def __init__(self, type: str, text: str = ""):
        self.type = type  # "agent" or "exit"
        self.text = text


# ---------------------------------------------------------------------------
# VTFrame — gradient border container for prompt_toolkit
# ---------------------------------------------------------------------------

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
        total_rows = max(20, 5)  # fixed estimate for gradient

        # Title: "Yips Virtual Terminal"
        title_text: StyleAndTextTuples = []
        prefix = "╭─── "
        for i, ch in enumerate(prefix):
            title_text.append((self._get_style(0, i, total_rows, total_cols), ch))

        yips_str = "Yips"
        for i, ch in enumerate(yips_str):
            progress = i / max(len(yips_str) - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            title_text.append((f"#{r:02x}{g:02x}{b:02x}", ch))

        title_text.append((self._get_style(0, len(title_text), total_rows, total_cols), " "))

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


class NoCprOutputWrapper:
    """Wrapper for Output that suppresses CPR (Cursor Position Requests)."""
    def __init__(self, original_output):
        self._original = original_output

    def __getattr__(self, name):
        return getattr(self._original, name)

    def get_cursor_position(self, timeout: float | None = None):
        """Return a dummy cursor position."""
        from prompt_toolkit.data_structures import Point
        return Point(0, 0)

    def ask_for_cpr(self) -> None:
        """Suppress sending CPR request."""
        pass

    @property
    def responds_to_cpr(self) -> bool:
        """Tell prompt_toolkit we do not support CPR."""
        return False


# ---------------------------------------------------------------------------
# VTApplication — terminal emulator using prompt_toolkit + pyte
# ---------------------------------------------------------------------------

class VTApplication:
    """prompt_toolkit Application for VT mode — persistent PTY terminal emulator."""

    def __init__(self, agent: object = None) -> None:
        from prompt_toolkit import Application
        from prompt_toolkit.output.color_depth import ColorDepth
        from prompt_toolkit.key_binding import KeyBindings, KeyPressEvent
        from prompt_toolkit.keys import Keys
        from prompt_toolkit.styles import Style
        from prompt_toolkit.layout.containers import HSplit, Window, ConditionalContainer
        from prompt_toolkit.layout.controls import FormattedTextControl
        from prompt_toolkit.layout.layout import Layout
        from prompt_toolkit.widgets import TextArea
        from prompt_toolkit.filters import Condition
        from prompt_toolkit.input import create_input
        from prompt_toolkit.output import create_output
        self.agent = agent
        self._result: VTResult | None = None
        self.pty = get_pty_session()

        # Terminal display window (reads from pyte screen)
        self.terminal_window = Window(
            content=FormattedTextControl(
                self._get_terminal_text,
                focusable=True,
                show_cursor=True,
            ),
            dont_extend_height=True,
            wrap_lines=False,
        )

        # Agent input TextArea
        self.agent_input = TextArea(
            multiline=False,
            prompt=[("#ffccff", ">>> ")],
            style="#ffccff",
            accept_handler=self._on_agent_submit,
        )

        # Frame wraps terminal window
        self.frame = VTFrame(self.terminal_window)

        # Root layout — only show agent input when it has focus (shift-tab to switch)
        self._show_agent_input = Condition(lambda: self._agent_focused())
        root = HSplit([
            self.frame.container,
            ConditionalContainer(self.agent_input, filter=self._show_agent_input),
        ])

        self.layout = Layout(root, focused_element=self.terminal_window)

        # Define filters
        self.terminal_focused = Condition(self._terminal_focused)
        self.agent_focused = Condition(self._agent_focused)

        # Key bindings
        self.kb = KeyBindings()

        # --- Terminal-focused bindings (route keystrokes to PTY) ---

        @self.kb.add(Keys.Any, eager=True, filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            data = event.data
            self.pty.write(data.encode('utf-8'))

        @self.kb.add('enter', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\r')

        @self.kb.add('backspace', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x7f')

        @self.kb.add('delete', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[3~')

        @self.kb.add('up', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[A')

        @self.kb.add('down', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[B')

        @self.kb.add('right', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[C')

        @self.kb.add('left', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[D')

        @self.kb.add('home', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[H')

        @self.kb.add('end', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1b[F')

        @self.kb.add('c-c', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x03')

        @self.kb.add('c-d', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x04')

        @self.kb.add('c-z', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x1a')

        @self.kb.add('c-l', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x0c')

        @self.kb.add('c-a', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x01')

        @self.kb.add('c-e', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x05')

        @self.kb.add('c-w', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x17')

        @self.kb.add('c-u', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x15')

        @self.kb.add('c-k', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x0b')

        @self.kb.add('c-r', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\x12')

        # --- Focus switching (EAGER priority) ---

        @self.kb.add('s-tab', eager=True)
        def _(event: KeyPressEvent) -> None:
            if self.layout.has_focus(self.terminal_window):
                self.layout.focus(self.agent_input)
            else:
                self.layout.focus(self.terminal_window)

        @self.kb.add('tab', filter=self.agent_focused)
        def _(event: KeyPressEvent) -> None:
            self.layout.focus(self.terminal_window)

        # Tab in terminal sends literal tab
        @self.kb.add('tab', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            self.pty.write(b'\t')

        # --- Exit / Escape ---

        @self.kb.add('escape', filter=self.agent_focused)
        def _(event: KeyPressEvent) -> None:
            self._result = VTResult("exit")
            event.app.exit()

        @self.kb.add('escape', filter=self.terminal_focused)
        def _(event: KeyPressEvent) -> None:
            # Pass escape to PTY for apps like vim
            self.pty.write(b'\x1b')

        vt_style = Style.from_dict({
            '': '',
            'bottom-toolbar': 'noinherit noreverse',
        })

        # Create fresh input/output to avoid conflicts with main session
        # and to strictly control CPR behavior.
        self.input = create_input()
        self.output = NoCprOutputWrapper(create_output())

        self.app: Application = Application(
            layout=self.layout,
            key_bindings=self.kb,
            style=vt_style,
            full_screen=False,
            color_depth=ColorDepth.TRUE_COLOR,
            input=self.input,
            output=self.output,
        )

    def _terminal_focused(self) -> bool:
        """Filter: True when terminal pane has focus."""
        return self.layout.has_focus(self.terminal_window)

    def _agent_focused(self) -> bool:
        """Filter: True when agent input has focus."""
        return self.layout.has_focus(self.agent_input)

    def _get_pt_cursor_position(self):
        """Return prompt_toolkit Point for the pyte cursor so the hardware cursor overlaps our reverse-video cursor."""
        from prompt_toolkit.data_structures import Point
        screen = self.pty.screen
        return Point(x=screen.cursor.x, y=screen.cursor.y)

    def _get_terminal_text(self):
        """Build prompt_toolkit formatted text from pyte screen buffer."""
        from prompt_toolkit.formatted_text import FormattedText

        result = []
        screen = self.pty.screen

        # Calculate effective height: max(cursor_y, last_non_empty_line)
        cursor_y = screen.cursor.y
        max_y = 0
        for y in range(screen.lines - 1, -1, -1):
            line = screen.buffer[y]
            has_content = False
            for char_obj in line.values():
                if char_obj.data and char_obj.data.strip():
                    has_content = True
                    break
            if has_content:
                max_y = y
                break
        
        # Enforce minimum height (e.g. 1) and max height (screen.lines)
        visible_rows = max(max_y, cursor_y) + 1
        visible_rows = max(visible_rows, 1)
        visible_rows = min(visible_rows, screen.lines)

        for y in range(visible_rows):
            if y > 0:
                result.append(('#ffffff', '\n'))

            line = screen.buffer[y]
            for x in range(screen.columns):
                char_obj = line[x]
                char = char_obj.data if char_obj.data else ' '

                # Build style from pyte char attributes
                style_parts = []
                fg = char_obj.fg
                if fg and fg != 'default':
                    # pyte returns color names or hex codes
                    hex_fg = _pyte_color_to_hex(fg)
                    if hex_fg:
                        style_parts.append(hex_fg)
                else:
                    style_parts.append('#ffffff')

                bg = char_obj.bg
                if bg and bg != 'default':
                    hex_bg = _pyte_color_to_hex(bg)
                    if hex_bg:
                        style_parts.append(f'bg:{hex_bg}')

                if char_obj.bold:
                    style_parts.append('bold')
                if char_obj.underscore:
                    style_parts.append('underline')
                if char_obj.reverse:
                    style_parts.append('reverse')

                # Render cursor as reverse video only when terminal is focused
                if y == screen.cursor.y and x == screen.cursor.x:
                    if self._terminal_focused():
                        style_parts.append('reverse')
                    style_parts.append('[SetCursorPosition]')

                style = ' '.join(style_parts) if style_parts else '#ffffff'
                result.append((style, char))

        return FormattedText(result)

    def _on_agent_submit(self, buff) -> None:
        text = buff.text.strip()
        if not text:
            return
        self._result = VTResult("agent", text)
        self.app.exit()

    async def _reader_task(self) -> None:
        """Background task that polls PTY for new output."""
        import asyncio
        while True:
            if self.pty.read():
                self.app.invalidate()
            # Also check if shell died
            if not self.pty.is_alive():
                self.app.invalidate()
            await asyncio.sleep(0.02)

    def run(self) -> VTResult:
        """Run the VT application. Returns VTResult."""
        self._result = None

        def start_bg_task() -> None:
            self.app.create_background_task(self._reader_task())
            # Ensure focus is on terminal window at start
            try:
                self.layout.focus(self.terminal_window)
            except Exception:
                pass

        # Start background reader via pre_run hook to ensure loop exists
        self.app.run(pre_run=start_bg_task)
        return self._result or VTResult("exit")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Standard 8-color + bright color names used by pyte
_PYTE_NAMED_COLORS = {
    'black': '#000000', 'red': '#cc0000', 'green': '#00cc00',
    'brown': '#cccc00', 'yellow': '#cccc00', 'blue': '#0000cc',
    'magenta': '#cc00cc', 'cyan': '#00cccc', 'white': '#cccccc',
    'brightblack': '#666666', 'brightred': '#ff0000', 'brightgreen': '#00ff00',
    'brightyellow': '#ffff00', 'brightblue': '#5555ff', 'brightmagenta': '#ff00ff',
    'brightcyan': '#00ffff', 'brightwhite': '#ffffff',
    'default': '#ffffff',
}

# xterm-256 standard color palette (0-15 are the named colors above)
_XTERM_256: list[str] | None = None


def _build_xterm_256() -> list[str]:
    """Build the xterm 256-color palette."""
    palette = [
        '#000000', '#800000', '#008000', '#808000', '#000080', '#800080',
        '#008080', '#c0c0c0', '#808080', '#ff0000', '#00ff00', '#ffff00',
        '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
    ]
    # 216 color cube (6x6x6)
    for r in range(6):
        for g in range(6):
            for b in range(6):
                rv = 55 + 40 * r if r else 0
                gv = 55 + 40 * g if g else 0
                bv = 55 + 40 * b if b else 0
                palette.append(f'#{rv:02x}{gv:02x}{bv:02x}')
    # 24 grayscale
    for i in range(24):
        v = 8 + 10 * i
        palette.append(f'#{v:02x}{v:02x}{v:02x}')
    return palette


def _pyte_color_to_hex(color: str) -> str | None:
    """Convert a pyte color value to a hex color string."""
    global _XTERM_256
    if not color or color == 'default':
        return None
    # Named color
    lower = color.lower()
    if lower in _PYTE_NAMED_COLORS:
        return _PYTE_NAMED_COLORS[lower]
    # 6-digit hex (pyte sometimes gives these without #)
    if len(color) == 6:
        try:
            int(color, 16)
            return f'#{color}'
        except ValueError:
            pass
    if color.startswith('#'):
        return color
    # Numeric index (256-color)
    try:
        idx = int(color)
        if 0 <= idx <= 255:
            if _XTERM_256 is None:
                _XTERM_256 = _build_xterm_256()
            return _XTERM_256[idx]
    except ValueError:
        pass
    return None


def main(initial_command: str | None = None):
    """Run the Virtual Terminal inline (execute initial_command and return)."""
    if initial_command:
        pty_session = get_pty_session()
        pty_session.write((initial_command + '\n').encode())
        # Give it a moment to execute
        import time
        time.sleep(0.3)
        pty_session.read()
        lines = get_visible_lines()
        if lines:
            width = get_vt_box_width()
            console.print(render_vt_top("VT", width=width))
            for row in render_vt_content_rows(width=width):
                console.print(row)
            console.print(render_vt_bottom(width=width))


if __name__ == "__main__":
    cmd = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else None
    main(initial_command=cmd)