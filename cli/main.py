"""
Main entry point for Yips CLI.

Provides the main() function that initializes and runs the YipsAgent.
"""

import os
import sys
import subprocess
import termios
from typing import Any, cast

from prompt_toolkit.application import Application
from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding.key_processor import KeyPressEvent
from prompt_toolkit.styles import Style as PromptStyle
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout.containers import ConditionalContainer, HSplit, Window
from prompt_toolkit.filters import Condition
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.output import ColorDepth
from prompt_toolkit.widgets import TextArea
import time
from rich.live import Live
from rich.console import RenderableType

from cli.agent import YipsAgent
from cli.type_defs import YipsAgentProtocol
from cli.ui_rendering import (
    render_tool_batch,
    show_booting,
)
from cli.color_utils import (
    console,
    print_yips,
    PROMPT_COLOR,
)
from cli.commands import handle_command
from cli.tool_execution import parse_tool_requests, execute_tool, clean_response
from cli.completer import SlashCommandCompleter


def run_inline_prompt(
    agent: YipsAgentProtocol,
    completer: SlashCommandCompleter,
    style: PromptStyle,
    bindings: KeyBindings,
) -> str:
    """Run the normal CLI prompt with a fixed status row directly underneath."""
    result: dict[str, str] = {"text": ""}

    def _accept(buff: Any) -> bool:
        result["text"] = buff.text
        app.exit(result=buff.text)
        return True

    input_area = TextArea(
        multiline=False,
        prompt=[(PROMPT_COLOR, ">>> ")],
        style=PROMPT_COLOR,
        completer=completer,
        complete_while_typing=True,
        accept_handler=_accept,
        wrap_lines=False,
    )

    status_row = Window(
        content=FormattedTextControl(agent.get_prompt_status_fragments),
        height=1,
        dont_extend_height=True,
    )
    had_status_row = bool(getattr(agent, "last_stream_status_text", ""))
    root = HSplit([
        input_area,
        ConditionalContainer(
            content=status_row,
            filter=Condition(lambda: bool(getattr(agent, "last_stream_status_text", ""))),
        ),
    ])
    app: Application[str] = Application(
        layout=Layout(root, focused_element=input_area.window),
        key_bindings=bindings,
        style=style,
        color_depth=ColorDepth.TRUE_COLOR,
        full_screen=False,
    )

    app.run()
    if had_status_row:
        sys.stdout.write("\x1b[1A\x1b[2K\r")
        sys.stdout.flush()
    return result["text"]


def process_response_and_tools(agent: YipsAgentProtocol, response: str, depth: int = 0) -> None:
    """Recursively process response, execute tools, and handle standardized ReAct loop."""
    from cli.config import load_config, DEFAULT_MAX_DEPTH

    config = load_config()
    max_depth = config.get("max_depth", DEFAULT_MAX_DEPTH)

    if depth >= max_depth:
        console.print(f"[red]Max autonomous depth ({max_depth}) reached.[/red]")
        return

    # 1. Clean and display the assistant response text
    cleaned = clean_response(response)
    if cleaned:
        # Only print if streaming is disabled OR if it's an error/special message
        # (Streaming logic in agent.py handles its own printing)
        if not agent.streaming_enabled or response.startswith("["):
            print_yips(cleaned)

    # 2. Parse tool requests
    tool_requests = parse_tool_requests(response)
    if not tool_requests:
        return

    # 3. Execute tool requests
    total_requests = len(tool_requests)

    # Batch tracking for UI
    tool_history: list[dict[str, Any]] = []
    summary_text = ""
    if depth == 0:
        summary_text = f"⚡ Executing {total_requests} tool call{'s' if total_requests != 1 else ''}..."
    else:
        summary_text = f"↻ Executing {total_requests} additional tool call{'s' if total_requests != 1 else ''}..."

    has_reprompt = False
    reprompt_msg = ""

    if agent.is_gui:
        # GUI Mode: Just process tools without Live display
        for i, request in enumerate(tool_requests, 1):
            if request["type"] == "thought":
                agent.session_state["thought_signature"] = request["signature"]
                continue

            tool_name = "unknown"
            params: Any = ""
            if request["type"] == "action":
                tool_name = request["tool"]
                params = request["params"]
            elif request["type"] == "identity":
                tool_name = "update_identity"
                params = request["reflection"]
            elif request["type"] == "skill":
                tool_name = request["skill"]
                params = request["args"]

            result = execute_tool(request, agent)

            if "[Error" in result or "failed" in result.lower():
                agent.session_state["error_count"] = agent.session_state.get("error_count", 0) + 1
            else:
                agent.session_state["error_count"] = 0

            agent.session_state["last_action"] = f"{tool_name}: {params}"

            if result == "::YIPS_EXIT::":
                sys.exit(0)

            import json
            metadata = {
                "tool": tool_name,
                "params": params,
                "result": str(result)
            }
            agent.conversation_history.append({
                "role": "system",
                "content": json.dumps(metadata)
            })

            if result.startswith("::YIPS_REPROMPT::"):
                has_reprompt = True
                reprompt_msg = result[17:]
    else:
        # Terminal Mode: Use Live for batch tool rendering
        renderable = cast(RenderableType, render_tool_batch(tool_history, summary_text, compact=True))
        with Live(renderable, console=console, refresh_per_second=10, transient=False) as live:
            for i, request in enumerate(tool_requests, 1):
                if request["type"] == "thought":
                    agent.session_state["thought_signature"] = request["signature"]
                    continue

                tool_name = "unknown"
                params: Any = ""
                if request["type"] == "action":
                    tool_name = request["tool"]
                    params = request["params"]
                elif request["type"] == "identity":
                    tool_name = "update_identity"
                    params = request["reflection"]
                elif request["type"] == "skill":
                    tool_name = request["skill"]
                    params = request["args"]

                prefix = f"({i}/{total_requests})" if total_requests > 1 else "▶"
                display_name = f"{prefix} {tool_name}"

                current_tool_info = {
                    "name": display_name,
                    "params": params,
                    "is_running": True,
                    "result": None
                }
                tool_history.append(current_tool_info)
                live.update(cast(RenderableType, render_tool_batch(tool_history, summary_text, compact=True)))

                if i > 1:
                    time.sleep(0.3)

                # Stop Live display before executing tools — any tool may
                # prompt for user input (confirmation dialogs, diff previews)
                live.stop()
                result = execute_tool(request, agent)
                live.start()

                current_tool_info["is_running"] = False
                current_tool_info["result"] = result
                live.update(cast(RenderableType, render_tool_batch(tool_history, summary_text, compact=True)))

                if "[Error" in result or "failed" in result.lower():
                    agent.session_state["error_count"] = agent.session_state.get("error_count", 0) + 1
                else:
                    agent.session_state["error_count"] = 0

                agent.session_state["last_action"] = f"{tool_name}: {params}"

                try:
                    from cli.config import DOT_YIPS_DIR
                    import json
                    metrics_path = DOT_YIPS_DIR / "metrics.json"
                    if metrics_path.exists():
                        metrics: dict[str, Any] = json.loads(metrics_path.read_text())
                        metrics["total_actions"] = metrics.get("total_actions", 0) + 1
                        if not ("[Error" in result or "failed" in result.lower()):
                            metrics["successes"] = metrics.get("successes", 0) + 1
                        metrics_path.write_text(json.dumps(metrics, indent=2))
                except Exception:
                    pass

                if result == "::YIPS_EXIT::":
                    sys.exit(0)

                import json
                metadata = {
                    "tool": tool_name,
                    "params": params,
                    "result": str(result)
                }
                agent.conversation_history.append({
                    "role": "system",
                    "content": json.dumps(metadata)
                })

                if result.startswith("::YIPS_REPROMPT::"):
                    has_reprompt = True
                    reprompt_msg = result[17:]

            # Final update
            live.update(cast(RenderableType, render_tool_batch(tool_history, summary_text, compact=False)))

    # Standardized ReAct loop: Always trigger next turn if tools were called
    if not has_reprompt:
        from cli.config import INTERNAL_REPROMPT
        reprompt_msg = INTERNAL_REPROMPT

        # If we have consecutive errors, inject a pivot prompt
        error_count = agent.session_state.get("error_count", 0)
        if error_count > 0:
            reprompt_msg = f"Observation received. NOTE: You have encountered {error_count} consecutive error(s). If your current approach is failing, consider a different tool or strategy (Pivot)."

    # Add the reprompt message to history
    agent.conversation_history.append({
        "role": "user",
        "content": reprompt_msg
    })

    # Recursive call for the next turn
    next_response = agent.get_response(reprompt_msg)

    # Store assistant response
    agent.conversation_history.append({
        "role": "assistant",
        "content": next_response
    })

    process_response_and_tools(agent, next_response, depth + 1)


def main() -> None:
    """Main entry point for Yips CLI."""
    import argparse
    import atexit
    from commands.tools.VT.VT import kill_pty_session
    atexit.register(kill_pty_session)

    parser = argparse.ArgumentParser(description="Yips - Personal Desktop Agent")
    parser.add_argument("-c", "--command", type=str, help="Run a single command and exit")
    args = parser.parse_args()

    completer = SlashCommandCompleter()

    # Create custom style for prompt_toolkit input
    style = PromptStyle.from_dict({
        '': PROMPT_COLOR,  # Input text color (e.g., #FFCCFF)
        'completion-menu': 'noinherit',
        'completion-menu.completion': 'noinherit',
        'completion-menu.completion.current': 'noinherit reverse',
        'completion-menu.meta': 'noinherit',
        'completion-menu.meta.completion': 'noinherit',
        'completion-menu.meta.completion.current': 'noinherit reverse',
        'scrollbar.background': 'noinherit',
        'scrollbar.button': 'noinherit',
    })


    # Define key bindings
    bindings = KeyBindings()

    @bindings.add('enter', eager=True)
    @bindings.add('c-m', eager=True)
    @bindings.add('c-j', eager=True)
    def _(event: KeyPressEvent):
        """Handle Enter key. Do not submit if empty."""
        buffer = event.current_buffer
        if not buffer.text.strip() and not buffer.text.startswith("::"):
            return
        buffer.validate_and_handle()

    vt_mode = False
    just_exited_vt = False

    VT_TOGGLE_SENTINEL = "::VT_TOGGLE::"

    def _do_vt_toggle(event: KeyPressEvent) -> None:
        """Toggle VT mode and submit sentinel."""
        nonlocal vt_mode
        vt_mode = not vt_mode
        buf = event.current_buffer
        buf.text = VT_TOGGLE_SENTINEL
        buf.validate_and_handle()

    @bindings.add('s-tab')
    def _(event: KeyPressEvent):
        """Toggle Virtual Terminal mode with Shift+Tab"""
        _do_vt_toggle(event)

    @bindings.add('tab')
    def _(event: KeyPressEvent):
        """Tab toggles VT mode when buffer is empty, otherwise do nothing (no completion)."""
        if not event.current_buffer.text.strip():
            _do_vt_toggle(event)
        # If buffer has text, swallow Tab (no tab-completion in this app)

    # Initialize PromptSession
    session: PromptSession[str] = PromptSession(
        style=style,
        completer=completer,
        complete_while_typing=True,
        key_bindings=bindings,
        color_depth=ColorDepth.TRUE_COLOR
    )

    # Create agent and pass session reference
    agent = YipsAgent(prompt_session=session)

    is_gui = os.environ.get("YIPS_GUI_MODE") == "1"

    # Save original terminal settings
    fd = sys.stdin.fileno()
    is_tty = os.isatty(fd)
    old_settings = termios.tcgetattr(fd) if is_tty else None
    settings_changed = False

    try:
        if not is_gui and is_tty:
            # Disable echo during startup (keep other flags normal)
            new_settings = termios.tcgetattr(fd)
            new_settings[3] = new_settings[3] & ~termios.ECHO
            termios.tcsetattr(fd, termios.TCSANOW, new_settings)
            settings_changed = True

            # Clear terminal
            subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)

            # Render the title box
            agent.render_title_box()

        # Initialize backend after displaying UI
        with show_booting("Booting Yips..."):
            agent.initialize_backend()

            # Precache HF model data in background for snappy /download command
            try:
                from cli.download_ui import HFModelManager
                HFModelManager.precache_background()
            except Exception:
                pass # Silently fail if HF is unavailable during boot

        # Flush any keystrokes buffered during startup BEFORE restoring echo
        # This prevents them from being echoed to the screen
        termios.tcflush(sys.stdin, termios.TCIFLUSH)

    except Exception:
        # Ensure terminal is restored if init fails so user sees the error
        if settings_changed:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        raise

    # Restore terminal settings (re-enables echo)
    if settings_changed:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

    if args.command:
        # Handle single command mode
        user_input = args.command.strip()

        # Store user message
        agent.conversation_history.append({
            "role": "user",
            "content": user_input
        })

        # Get response
        response = agent.get_response(user_input)

        # Store assistant response
        agent.conversation_history.append({
            "role": "assistant",
            "content": response
        })

        # Process response and any tools (recursively)
        process_response_and_tools(agent, response)

        # Add a blank line to separate this turn from the next prompt
        console.print()

        # Update session memory file
        agent.update_session_file()

        agent.graceful_exit()
        sys.exit(0)

    while True:
        # Check for pending resize
        if not is_gui and agent.resize_pending:
            agent.resize_pending = False
            agent.last_width = agent.console.width
            agent.refresh_display()

        try:
            if is_gui:
                # In GUI mode, use a simple input() to read from stdin
                user_input = input().strip()
            elif vt_mode:
                # VT mode: use prompt_toolkit Application with integrated layout
                from commands.tools.VT.VT import VTApplication

                vt_app = VTApplication(agent=agent)
                result = vt_app.run()

                just_exited_vt = True  # Flag to suppress immediate summary re-render

                if result.type == "agent":
                    user_input = result.text
                    vt_mode = False
                else:  # "exit"
                    vt_mode = False
                    continue
            else:
                from commands.tools.VT.VT import (
                    render_vt_top, render_vt_content_rows, render_vt_bottom,
                    vt_history_len, get_vt_box_width, has_vt_history,
                )

                _vt_box_lines = 0
                width = get_vt_box_width()

                # Agent mode: fully closed box showing PTY history
                # Suppress rendering if we just exited the interactive VT (it's already on screen)
                if has_vt_history() and not just_exited_vt:
                    console.print(render_vt_top("VT", width=width))
                    for row in render_vt_content_rows(width=width):
                        console.print(row)
                    console.print(render_vt_bottom(width=width))
                    _vt_box_lines = vt_history_len() + 2  # top + content + bottom
                
                just_exited_vt = False  # Reset flag after one suppression

                # Agent prompt below the closed box
                session.style = style
                user_input = run_inline_prompt(
                    agent=agent,
                    completer=completer,
                    style=style,
                    bindings=bindings,
                ).strip()

                if user_input == VT_TOGGLE_SENTINEL:
                    if _vt_box_lines > 0:
                        sys.stdout.write(f"\033[{_vt_box_lines + 1}A\033[J")
                        sys.stdout.flush()
                    else:
                        agent.refresh_display()
                    vt_mode = True
                    continue
        except (EOFError, KeyboardInterrupt):
            agent.graceful_exit()
            sys.exit(0)

        if not user_input:
            continue

        # /vt toggles VT mode directly
        if user_input.lower() in ('/vt', '/terminal'):
            vt_mode = not vt_mode
            if not vt_mode:
                console.print("[dim]Exited VT mode.[/dim]")
            continue

        # Update user intervention metrics
        try:
            from cli.config import DOT_YIPS_DIR
            import json
            metrics_path = DOT_YIPS_DIR / "metrics.json"
            if metrics_path.exists():
                metrics: dict[str, Any] = json.loads(metrics_path.read_text())
                metrics["user_interventions"] = metrics.get("user_interventions", 0) + 1
                metrics_path.write_text(json.dumps(metrics, indent=2))
        except Exception:
            pass

        # Handle slash commands first
        command_result = handle_command(agent, user_input)
        if command_result == "exit":
            sys.exit(0)
        if isinstance(command_result, str) and command_result.startswith("::YIPS_REPROMPT::"):
            # Extract reprompt message and process it as a new user input
            reprompt_msg = command_result[17:]
            if reprompt_msg:
                user_input = reprompt_msg
            else:
                continue
        elif command_result:
            continue

        # Check if input is a simple bash command — auto-launch VT
        SIMPLE_BASH_COMMANDS = {
            'ls', 'pwd', 'cat', 'grep', 'find', 'mkdir', 'rmdir', 'rm', 'cp', 'mv',
            'touch', 'chmod', 'chown', 'echo', 'ps', 'top', 'htop', 'df', 'du',
            'tar', 'zip', 'unzip', 'curl', 'wget', 'ping', 'ssh', 'scp', 'man',
            'apt', 'pacman', 'pip', 'npm', 'docker', 'tree', 'wc', 'nano', 'vim',
            'clear', 'whoami', 'uname', 'uptime', 'free', 'lsblk', 'ip', 'ifconfig',
            'systemctl', 'journalctl', 'env', 'export', 'source', 'bat', 'cd',
        }
        first_word = user_input.split()[0] if user_input.split() else ''
        import shutil
        if first_word in SIMPLE_BASH_COMMANDS or (first_word and shutil.which(first_word)):
            from commands.tools.VT.VT import get_pty_session
            vt_mode = True
            pty = get_pty_session()
            pty.write((user_input + '\n').encode())
            continue

        # Store user message
        agent.conversation_history.append({
            "role": "user",
            "content": user_input
        })

        # Get response
        response = agent.get_response(user_input)

        # Store assistant response
        agent.conversation_history.append({
            "role": "assistant",
            "content": response
        })

        # Process response and any tools (recursively)
        process_response_and_tools(agent, response)

        # Add a blank line to separate this turn from the next prompt
        console.print()

        # Refresh title box to show updated context usage
        agent.refresh_title_box_only()

        # Update session memory file
        agent.update_session_file()


if __name__ == "__main__":
    main()
