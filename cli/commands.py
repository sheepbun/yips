"""
Slash command handlers for Yips CLI.

Handles built-in commands like /model, /verbose, /stream, /exit, and skill invocation.
"""

import os
import re
import subprocess
import sys
import time
from typing import Any

from cli.color_utils import console, print_gradient
from cli.config import load_config, save_config, SKILLS_DIR, TOOLS_DIR
from cli.root import PROJECT_ROOT
from cli.type_defs import YipsAgentProtocol
from cli.info_utils import (
    get_friendly_backend_name,
    get_friendly_model_name,
    get_session_list,
)
from cli.llamacpp import get_available_models as get_llama_models, stop_llamacpp, start_llamacpp


def handle_backend_command(agent: YipsAgentProtocol, args: str) -> None:
    """Handle the /backend command to switch backends."""
    args = args.strip().lower()
    
    valid_backends = ["llamacpp", "claude"]
    
    if not args:
        console.print(f"[cyan]Current backend:[/cyan] {get_friendly_backend_name(agent.backend)}")
        console.print(f"[dim]Available: {', '.join(valid_backends)}[/dim]")
        return
        
    if args not in valid_backends:
        console.print(f"[red]Invalid backend: {args}[/red]")
        console.print(f"[dim]Available: {', '.join(valid_backends)}[/dim]")
        return
        
    if args == agent.backend:
        console.print(f"[yellow]Already using {get_friendly_backend_name(args)} backend.[/yellow]")
        return
        
    # Switch backend
    
    # Cleanup current backend
    if agent.backend == "llamacpp":
        stop_llamacpp()
        
    agent.backend = args
    agent.use_claude_cli = (args == "claude")
    
    # Reset model to default for new backend
    if args == "claude":
        # Default model for Claude (hardcoded for now as we removed lmstudio constants)
        agent.current_model = "sonnet" 
    elif args == "llamacpp":
        from cli.llamacpp import LLAMA_DEFAULT_MODEL
        agent.current_model = LLAMA_DEFAULT_MODEL
        
    # Save config
    config = load_config()
    if args in ("claude", "llamacpp"):
        config["backend"] = args
    if agent.current_model:
        config["model"] = agent.current_model
    save_config(config)
    
    # Re-initialize
    agent.backend_initialized = False
    agent.new_session() # Clear session when switching backends
    agent.initialize_backend()
    
    console.print(f"[green]Switched to {get_friendly_backend_name(args)} backend.[/green]")
    agent.refresh_display()


def handle_sessions_command(agent: YipsAgentProtocol) -> None:
    """Handle /sessions command to interactively select and load a session."""
    sessions: list[dict[str, Any]] = get_session_list()
    if not sessions:
        console.print("[yellow]No session history found.[/yellow]")
        return

    # Set selection mode in agent
    agent.session_list = sessions
    agent.session_selection_idx = 0
    agent.session_selection_active = True
    
    # Clear screen to prepare for Live view
    subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)
    
    from rich.live import Live
    import sys
    import select
    from prompt_toolkit.input import create_input
    scroll_step = 0

    # Render initial frame
    try:
        initial_group = agent.get_title_box_group(scroll_step)
    except AttributeError:
        # Fallback if method missing (shouldn't happen with updated agent)
        agent.refresh_title_box_only()
        return

    # Use Live for smooth animation
    # screen=False allows us to render "in place" but since we cleared, it's at top
    # auto_refresh=False gives us manual control loop
    selected_session_path: Any | None = None
    last_render_time = 0.0
    render_interval = 0.1

    def _read_key(fd: int) -> str | None:
        """Read a single keypress from raw fd, resolving escape sequences with a short timeout."""
        try:
            data = os.read(fd, 1)
        except OSError:
            return None
            
        if not data:
            return None
        ch = data[0]
        if ch == 0x1b:  # Escape
            # Check if more bytes follow (escape sequence) or bare Escape
            if os.name == 'nt':
                import msvcrt, time as _t
                _end = _t.monotonic() + 0.05
                r_avail = False
                while _t.monotonic() < _end:
                    if msvcrt.kbhit():
                        r_avail = True
                        break
                    _t.sleep(0.005)
            else:
                r, _, _ = select.select([fd], [], [], 0.05)
                r_avail = bool(r)
            if r_avail:
                data2 = os.read(fd, 1)
                if data2 and data2[0] == 0x5b:  # '['
                    data3 = os.read(fd, 1)
                    if data3:
                        if data3[0] == 0x41:  # 'A'
                            return 'up'
                        elif data3[0] == 0x42:  # 'B'
                            return 'down'
                # Unknown sequence, consume and ignore
                return None
            return 'escape'
        elif ch in (0x0d, 0x0a):  # \r, \n
            return 'enter'
        return None

    input_obj = create_input()
    fd = sys.stdin.fileno()

    with Live(initial_group, console=agent.console, auto_refresh=False, transient=True) as live:
        try:
            with input_obj.raw_mode():
                while True:
                    # Drain all pending input
                    input_processed = False
                    escaped = False

                    while True:
                        # Check for input availability
                        if os.name == 'nt':
                            import msvcrt
                            if not msvcrt.kbhit():
                                break
                        else:
                            r, _, _ = select.select([fd], [], [], 0)
                            if not r:
                                break

                        key = _read_key(fd)
                        if key == 'up':
                            agent.session_selection_idx = (agent.session_selection_idx - 1) % len(sessions)
                            scroll_step = 0
                            input_processed = True
                        elif key == 'down':
                            agent.session_selection_idx = (agent.session_selection_idx + 1) % len(sessions)
                            scroll_step = 0
                            input_processed = True
                        elif key == 'enter':
                            selected_session_path = sessions[agent.session_selection_idx]['path']
                            break
                        elif key == 'escape':
                            escaped = True
                            break

                    if selected_session_path is not None or escaped:
                        break
                    
                    # Animate/Render
                    # Render if we processed input (responsiveness) OR if time elapsed (animation)
                    now = time.time()
                    if input_processed or (now - last_render_time >= render_interval):
                        if not input_processed:
                            # Only increment scroll if this is an animation frame, not user interaction
                            # (User interaction resets scroll_step to 0)
                            scroll_step += 1
                        
                        group = agent.get_title_box_group(scroll_step)
                        live.update(group)
                        live.refresh()
                        last_render_time = now
                    
                    # Short sleep to prevent CPU spinning
                    time.sleep(0.01)

        except Exception as e:
            console.print(f"[red]Error in session selection: {e}[/red]")
            time.sleep(2) # Show error

    # Restore normal view
    agent.session_selection_active = False
    
    if selected_session_path:
        agent.load_session(selected_session_path)
    else:
        agent.refresh_display()


def handle_model_command(agent: YipsAgentProtocol, args: str) -> str | bool:
    """Handle the /model command to display or switch models."""
    args = args.strip()

    # Claude models that switch to Claude CLI
    claude_models = {"haiku", "sonnet", "opus"}

    # Get available models
    llama_models = get_llama_models()

    if not args:
        from cli.model_manager import run_model_manager_ui
        result: str | bool | None = run_model_manager_ui(
            agent.current_model or "Default", agent.backend, agent
        )
        return result or True

    # Switch model
    model_name_lower = args.lower()

    if model_name_lower in claude_models:
        # User requested switch - clean up first
        stop_llamacpp()
        agent.new_session()
        
        agent.use_claude_cli = True
        agent.backend = "claude"
        agent.current_model = model_name_lower
        config = load_config()
        config.update({"backend": "claude", "model": model_name_lower, "verbose": agent.verbose_mode})
        save_config(config)
        console.print(f"[green]Switched to {get_friendly_backend_name('claude')} with model: {get_friendly_model_name(model_name_lower)}[/green]")
        agent.refresh_display()
    
    # Try llama.cpp models first (as it's the new preferred backend)
    elif args in llama_models or any(args.lower() in m.lower() for m in llama_models):
        matched = args if args in llama_models else next(
            (m for m in llama_models if args.lower() in m.lower()), None
        )
        if matched:
            stop_llamacpp()
            agent.new_session()
            
            agent.use_claude_cli = False
            agent.backend = "llamacpp"
            agent.current_model = matched
            config = load_config()
            config.update({"backend": "llamacpp", "model": matched, "verbose": agent.verbose_mode})
            save_config(config)

            if start_llamacpp(matched):
                console.print(f"[green]Switched to {get_friendly_backend_name('llamacpp')} with model: {get_friendly_model_name(matched)}[/green]")
            else:
                console.print(f"[red]Error: Failed to start server for {get_friendly_model_name(matched)}[/red]")

            agent.refresh_display()
            return True
    else:
        console.print(f"[red]Model not found: {args}[/red]")
        console.print("[dim]Use /model to see available models[/dim]")
    
    return True



def handle_nick_command(agent: YipsAgentProtocol, args: str) -> None:
    """Handle the /nick command to set a custom nickname for a model."""
    import shlex
    from cli.info_utils import set_model_nickname
    try:
        parts = shlex.split(args)
    except ValueError as e:
        console.print(f"[red]Error parsing arguments: {e}[/red]")
        return

    if len(parts) < 2:
        console.print("[yellow]Usage: /nick <model_name_or_filename> <nickname>[/yellow]")
        console.print("[dim]Example: /nick gpt-oss-20b-MXFP4 gpt-oss[/dim]")
        console.print("[dim]Example: /nick opus \"4.5 Opus\"[/dim]")
        return

    model_target = parts[0]
    nickname = parts[1]

    set_model_nickname(model_target, nickname)

    console.print(f"[green]Nickname set: {model_target} → {nickname}[/green]")
    agent.refresh_display()


def handle_slash_command(agent: YipsAgentProtocol, user_input: str) -> str | bool:
    """Handle slash commands (Tools and Skills). Returns 'exit' to quit, True if handled, False otherwise."""
    if not user_input.startswith("/"):
        return False

    # Parse command and args
    parts = user_input[1:].split(maxsplit=1)
    command = parts[0].lower() if parts else ""
    args = parts[1] if len(parts) > 1 else ""

    # Built-in commands
    if command in ("exit", "quit"):
        agent.graceful_exit()
        return "exit"

    if command in ("model", "models"):
        result = handle_model_command(agent, args)
        if isinstance(result, str) and result.startswith("/"):
            return handle_slash_command(agent, result)
        return True

    if command == "backend":
        handle_backend_command(agent, args)
        return True

    if command == "sessions":
        handle_sessions_command(agent)
        return True

    if command == "nick":
        handle_nick_command(agent, args)
        return True

    if command in ("clear", "new"):
        agent.new_session()
        # Check backend state - reload if necessary (e.g. to prioritize GPU)
        if agent.backend == "llamacpp":
            start_llamacpp(agent.current_model)
        return True

    if command == "verbose":
        # Toggle verbose mode
        agent.verbose_mode = not agent.verbose_mode
        config = load_config()
        config["verbose"] = agent.verbose_mode
        save_config(config)
        status = "enabled" if agent.verbose_mode else "disabled"
        console.print(f"[green]Verbose mode (reasoning panels and tool details): {status}[/green]")
        return True

    if command == "stream":
        # Toggle streaming mode
        agent.streaming_enabled = not agent.streaming_enabled
        config = load_config()
        config["streaming"] = agent.streaming_enabled
        save_config(config)
        status = "enabled" if agent.streaming_enabled else "disabled"
        console.print(f"[green]Streaming mode: {status}[/green]")
        agent.refresh_display()
        return True

    if command in ("download", "dl"):
        from cli.download_ui import run_download_ui
        result = run_download_ui(agent)
        if isinstance(result, str) and result.startswith("/"):
            return handle_slash_command(agent, result)
        return True

    if command in ("gateway", "gw"):
        from cli.gateway.gateway_ui import run_gateway_ui
        run_gateway_ui(agent)
        return True

    # Check for command directory (case-insensitive) in tools then skills
    cmd_dir = None
    # Priority 1: Tools
    cmd_dir = next((d for d in TOOLS_DIR.iterdir() if d.is_dir() and d.name.lower() == command), None)
    # Priority 2: Skills
    if not cmd_dir:
        cmd_dir = next((d for d in SKILLS_DIR.iterdir() if d.is_dir() and d.name.lower() == command), None)
    
    if cmd_dir:
        handled = False
        
        # 1. Display Markdown skill if exists
        skill_path = cmd_dir / f"{cmd_dir.name}.md"
        if skill_path.exists():
            try:
                content = skill_path.read_text()
                print_gradient(content)
                handled = True
            except Exception as e:
                console.print(f"[red]Error reading skill /{command}: {e}[/red]")

        # 2. Run Python tool if exists
        tool_path = cmd_dir / f"{cmd_dir.name}.py"
        if tool_path.exists():
            try:
                # Prefer venv python for tool execution if available
                if sys.platform == "win32":
                    venv_python = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
                else:
                    venv_python = PROJECT_ROOT / ".venv" / "bin" / "python3"
                executable = str(venv_python) if venv_python.exists() else sys.executable

                cmd = [executable, str(tool_path)] + (args.split() if args else [])
                env = {**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
                
                # Check for control commands in output
                output = result.stdout
                
                # Pattern: ::YIPS_COMMAND::COMMAND::ARGS
                command_pattern = r'::YIPS_COMMAND::(\w+)::(.*)'
                should_exit = False
                
                for match in re.finditer(command_pattern, output):
                    cmd_name = match.group(1).upper()
                    cmd_args = match.group(2).strip()
                    
                    if cmd_name == "RENAME":
                        if hasattr(agent, 'rename_session'):
                            agent.rename_session(cmd_args)
                    elif cmd_name == "EXIT":
                        if hasattr(agent, 'graceful_exit'):
                            agent.graceful_exit()
                            should_exit = True
                    elif cmd_name == "REPROMPT":
                        # Return special signal for reprompt
                        return f"::YIPS_REPROMPT::{cmd_args}"

                    # Filter out the command line
                    output = output.replace(match.group(0), "")
                
                output = output.strip()
                if output:
                    print_gradient(output)
                    
                if result.stderr.strip():
                    console.print(f"[red]{result.stderr.strip()}[/red]")
                    
                if should_exit:
                    return "exit"
                handled = True
            except subprocess.TimeoutExpired:
                console.print(f"[red]Tool /{command} timed out[/red]")
                handled = True
            except Exception as e:
                console.print(f"[red]Error running tool /{command}: {e}[/red]")
                handled = True
        
        if handled:
            return True

    # Unknown command
    console.print(f"[red]Unknown command: /{command}[/red]")
    available: list[str] = []
    if TOOLS_DIR.exists():
        available.extend([d.name.lower() for d in TOOLS_DIR.iterdir() if d.is_dir()])
    if SKILLS_DIR.exists():
        available.extend([d.name.lower() for d in SKILLS_DIR.iterdir() if d.is_dir()])
    available.extend(["exit", "model", "backend", "verbose", "stream", "sessions", "clear", "new", "download", "models", "gateway", "gw"])
    console.print(f"[dim]Available: /{', /'.join(sorted(list(set(available))))}[/dim]")
    return True


def handle_command(agent: YipsAgentProtocol, user_input: str) -> str | bool:
    """Unified command handler for all slash commands."""
    return handle_slash_command(agent, user_input)
