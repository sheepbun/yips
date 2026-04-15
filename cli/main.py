"""
Main entry point for Yips CLI.

Provides the main() function that initializes and runs the YipsAgent.
"""

import os
import sys
import subprocess
from typing import Any, cast

if os.name != 'nt':
    import termios

from prompt_toolkit.application import Application
from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding.key_processor import KeyPressEvent
from prompt_toolkit.styles import Style as PromptStyle
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout.containers import ConditionalContainer, Float, FloatContainer, HSplit, Window
from prompt_toolkit.filters import Condition
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.layout.menus import CompletionsMenu
from prompt_toolkit.output import ColorDepth
from prompt_toolkit.widgets import TextArea
import time
from rich.live import Live
from rich.console import RenderableType, Group

from cli.agent import (
    YipsAgent,
    _EXTERNAL_ACTIVITY_SENTINEL,
    _RESIZE_SENTINEL,
)
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
    app_ref: list[Any] = [None]
    draft_text = getattr(agent, "interrupted_input_text", "")

    def _accept(buff: Any) -> bool:
        result["text"] = buff.text
        app_ref[0].exit(result=buff.text)
        return True

    had_status_row = bool(getattr(agent, "last_stream_status_text", ""))

    while True:
        input_area = TextArea(
            multiline=False,
            prompt=[(PROMPT_COLOR, ">>> ")],
            text=draft_text,
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
        root = HSplit([
            input_area,
            ConditionalContainer(
                content=status_row,
                filter=Condition(lambda: bool(getattr(agent, "last_stream_status_text", ""))),
            ),
        ])
        layout_root = FloatContainer(
            content=root,
            floats=[
                Float(
                    xcursor=True,
                    ycursor=True,
                    content=CompletionsMenu(max_height=16),
                )
            ],
        )
        app: Application[str] = Application(
            layout=Layout(layout_root, focused_element=input_area.window),
            key_bindings=bindings,
            style=style,
            color_depth=ColorDepth.TRUE_COLOR,
            full_screen=False,
        )

        app_ref[0] = app
        agent._prompt_app = app
        try:
            returned = app.run()
        finally:
            agent._prompt_app = None

        if returned == _RESIZE_SENTINEL:
            draft_text = getattr(agent, "interrupted_input_text", "") or input_area.text
            agent.interrupted_input_text = draft_text
            agent.refresh_display()
            continue

        if returned == _EXTERNAL_ACTIVITY_SENTINEL:
            draft_text = getattr(agent, "interrupted_input_text", "") or input_area.text
            agent.interrupted_input_text = draft_text
            agent.pending_external_activity_refresh = False
            agent.refresh_display()
            continue

        break

    agent.interrupted_input_text = ""
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
        preview_history: list[RenderableType] = []

        def build_tool_renderable(compact: bool) -> RenderableType:
            batch = cast(RenderableType, render_tool_batch(tool_history, summary_text, compact=compact))
            if not preview_history:
                return batch
            return Group(batch, *preview_history)

        renderable = build_tool_renderable(compact=True)
        with Live(renderable, console=console, refresh_per_second=10, transient=False) as live:
            def queue_preview(renderable: RenderableType) -> None:
                preview_history.append(renderable)
                live.update(build_tool_renderable(compact=True))

            def pause_live() -> None:
                live.stop()

            def resume_live() -> None:
                preview_history.clear()
                # Reset Rich's internal render-height tracker so the first refresh
                # after restart doesn't move the cursor UP past the preview content
                # that was permanently printed during the pause.
                try:
                    live._live_render._shape = (0, 0)
                except AttributeError:
                    pass
                live.start(refresh=True)
                live.update(build_tool_renderable(compact=True))

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
                live.update(build_tool_renderable(compact=True))

                if i > 1:
                    time.sleep(0.3)

                result = execute_tool(
                    request,
                    agent,
                    preview_callback=queue_preview,
                    pause_live=pause_live,
                    resume_live=resume_live,
                )

                current_tool_info["is_running"] = False
                current_tool_info["result"] = result
                live.update(build_tool_renderable(compact=True))

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
            live.update(build_tool_renderable(compact=False))

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


def install_self():
    """If running as a frozen binary, ensure it's installed in the .yips/bin directory."""
    if os.environ.get("YIPS_NPM_INSTALL") == "1":
        return
    if not getattr(sys, "frozen", False):
        return

    import shutil
    from pathlib import Path

    current_exe = Path(sys.executable).resolve()

    if os.name == "nt":
        appdata_yips = Path(os.environ.get("APPDATA", "")) / ".yips"
    else:
        appdata_yips = Path.home() / ".yips"

    bin_dir = appdata_yips / "bin"
    target_exe = bin_dir / ("yips.exe" if os.name == "nt" else "yips")

    # If already in the target directory, we're good
    try:
        if current_exe == target_exe.resolve():
            return
    except Exception:
        pass

    print("--- Yips Self-Installer ---")
    print(f"Installing Yips to: {bin_dir}")

    try:
        bin_dir.mkdir(parents=True, exist_ok=True)
        if target_exe.exists():
            try:
                target_exe.unlink()
            except Exception:
                pass
        
        shutil.copy2(current_exe, target_exe)
        if os.name != "nt":
            target_exe.chmod(0o755)

        print(f"Successfully copied Yips to {target_exe}")

        # Update PATH
        if os.name == "nt":
            # Simple PATH update via setx
            try:
                user_path = os.environ.get("PATH", "")
                if str(bin_dir).lower() not in user_path.lower():
                    subprocess.run(["setx", "PATH", f"{user_path};{bin_dir}"], capture_output=True)
                    print("Added Yips to your User PATH.")
            except Exception:
                print("Note: Could not automatically update PATH. Please add the bin directory manually.")
        else:
            # Unix PATH update
            shell_rc = None
            shell = os.environ.get("SHELL", "")
            if "zsh" in shell:
                shell_rc = Path.home() / ".zshrc"
            elif "bash" in shell:
                shell_rc = Path.home() / ".bashrc"

            if shell_rc and shell_rc.exists():
                content = shell_rc.read_text()
                if str(bin_dir) not in content:
                    with shell_rc.open("a") as f:
                        f.write(f'\n# Yips CLI\nexport PATH="$PATH:{bin_dir}"\n')
                    print(f"Added Yips to PATH in {shell_rc}")

        print("---------------------------")
        print("Installation complete! You can now run 'yips' from any terminal.")
        print("(Note: You may need to restart your terminal for changes to take effect.)")
        print("Continuing with first-time setup...")
        time.sleep(2)
    except Exception as e:
        print(f"Warning: Self-installation failed: {e}")


def main() -> None:
    """Main entry point for Yips CLI."""
    install_self()
    import argparse
    import atexit
    import signal
    from commands.tools.VT.VT import kill_pty_session
    atexit.register(kill_pty_session)

    signal.signal(signal.SIGINT, lambda *_: os._exit(0))

    parser = argparse.ArgumentParser(description="Yips - Personal Desktop Agent")
    parser.add_argument("mode", nargs="?", default="", help="Run mode (e.g., onboard)")
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

    @bindings.add('c-c', eager=True)
    def _(event: KeyPressEvent):
        os._exit(0)

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
        """Tab toggles VT mode when empty, otherwise drives prompt completion."""
        buffer = event.current_buffer
        if not buffer.text.strip():
            _do_vt_toggle(event)
            return

        if buffer.complete_state:
            buffer.complete_next()
        else:
            buffer.start_completion(select_first=False)

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

    # --- Onboarding Process ---
    from cli.config import load_config, save_config
    config = load_config()
    is_first_run = not config.get("onboarded", False)

    if (is_first_run or args.mode == "onboard") and not args.command:
        from cli.gateway.gateway_ui import run_gateway_ui
        from cli.download_ui import run_download_ui
        from cli.llamacpp import get_available_models

        # 1. Run Gateway UI
        run_gateway_ui(agent)

        # 2. Run Download UI if no models exist
        if not get_available_models():
            run_download_ui(agent)

        # 3. Save onboarded state
        config["onboarded"] = True
        save_config(config)

        # 4. Re-render title box if we used the UI
        if not is_gui and is_tty:
            subprocess.run('cls' if os.name == 'nt' else 'clear', shell=True)
            agent.render_title_box()

    old_settings = termios.tcgetattr(fd) if (is_tty and os.name != 'nt') else None
    settings_changed = False

    try:
        if not is_gui and is_tty and os.name != 'nt':
            # Disable echo during startup (keep other flags normal) — Unix only
            new_settings = termios.tcgetattr(fd)
            new_settings[3] = new_settings[3] & ~termios.ECHO
            termios.tcsetattr(fd, termios.TCSANOW, new_settings)
            settings_changed = True

        if not is_gui and is_tty:
            # Clear terminal and render the title box (all platforms)
            subprocess.run('cls' if os.name == 'nt' else 'clear', shell=True)
            agent.render_title_box()

        # Initialize backend and services in background
        import threading
        def background_init():
            try:
                # Initialize backend after displaying UI
                agent.initialize_backend(silent=True)

                # Precache HF model data in background for snappy /download command
                try:
                    from cli.download_ui import HFModelManager
                    HFModelManager.precache_background()
                except Exception:
                    pass # Silently fail if HF is unavailable during boot

                # Auto-start Discord bot if a token is configured
                try:
                    from cli.gateway.discord_service import (
                        set_discord_activity_callback, start_discord_service, is_discord_running,
                        is_discord_ready, get_discord_bot_name,
                    )
                    from cli.ui_rendering import BootingSpinner
                    set_discord_activity_callback(agent.request_external_activity_refresh)
                    start_discord_service()  # No-op if no token configured
                except Exception:
                    pass  # Don't block boot if Discord fails
            finally:
                agent.backend_ready_event.set()

        init_thread = threading.Thread(target=background_init, daemon=True)
        init_thread.start()

        # Flush any keystrokes buffered during startup BEFORE restoring echo
        # This prevents them from being echoed to the screen
        if os.name != 'nt':
            termios.tcflush(sys.stdin, termios.TCIFLUSH)

    except Exception:
        # Ensure terminal is restored if init fails so user sees the error
        if settings_changed and os.name != 'nt':
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        raise

    # Restore terminal settings (re-enables echo)
    if settings_changed and os.name != 'nt':
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
        if not is_gui and agent.pending_external_activity_refresh and agent._prompt_app is None:
            agent.pending_external_activity_refresh = False
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

                if result.type == "agent":
                    user_input = result.text
                    vt_mode = False
                else:  # "exit"
                    vt_mode = False
                    continue
            else:
                session.style = style
                user_input = run_inline_prompt(
                    agent=agent,
                    completer=completer,
                    style=style,
                    bindings=bindings,
                ).strip()

                if user_input == VT_TOGGLE_SENTINEL:
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

        # Check if input is a simple shell command — auto-launch VT
        if os.name == 'nt':
            SIMPLE_BASH_COMMANDS = {
                'dir', 'type', 'copy', 'move', 'del', 'ren', 'mkdir', 'rmdir', 'echo',
                'ping', 'curl', 'npm', 'pip', 'whoami', 'cls', 'cd', 'tree', 'set',
                'ipconfig', 'tasklist', 'taskkill', 'powershell', 'python', 'python3',
                'netstat', 'systeminfo', 'where', 'attrib', 'xcopy', 'robocopy',
            }
        else:
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
            agent.conversation_history.append({
                "role": "user",
                "content": user_input
            })
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
