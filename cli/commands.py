"""
Slash command handlers for Yips CLI.

Handles built-in commands like /model, /verbose, /stream, /exit, and skill invocation.
"""

import os
import re
import subprocess
import sys
import time
from typing import Protocol

from rich.console import Console
from rich.table import Table

from cli.color_utils import console, print_gradient
from cli.config import load_config, save_config, COMMANDS_DIR, SKILLS_DIR, TOOLS_DIR
from cli.root import PROJECT_ROOT
from cli.info_utils import (
    get_friendly_backend_name,
    get_friendly_model_name,
    get_session_list,
)
from cli.lmstudio import get_available_models as get_lm_models, unload_all_models
from cli.llamacpp import get_available_models as get_llama_models, stop_llamacpp


class YipsAgentProtocol(Protocol):
    """Interface that commands.py needs from YipsAgent."""
    use_claude_cli: bool
    backend: str
    current_model: str
    verbose_mode: bool
    streaming_enabled: bool
    console: Console
    session_selection_active: bool
    session_selection_idx: int
    session_list: list[dict]

    def refresh_display(self) -> None: ...
    def refresh_title_box_only(self) -> None: ...
    def graceful_exit(self) -> None: ...
    def load_session(self, file_path: any) -> bool: ...
    def new_session(self) -> None: ...
    def initialize_backend(self) -> None: ...


def handle_backend_command(agent: YipsAgentProtocol, args: str) -> None:
    """Handle the /backend command to switch backends."""
    args = args.strip().lower()
    
    valid_backends = ["llamacpp", "lmstudio", "claude"]
    
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
    console.print(f"[dim]Switching backend to {get_friendly_backend_name(args)}...[/dim]")
    
    # Cleanup current backend
    if agent.backend == "llamacpp":
        stop_llamacpp()
    elif agent.backend == "lmstudio":
        unload_all_models()
        # Also try to stop LM Studio server if possible
        try:
            subprocess.run(["lms", "server", "stop"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except: pass
        
    agent.backend = args
    agent.use_claude_cli = (args == "claude")
    
    # Reset model to default for new backend
    if args == "claude":
        from cli.lmstudio import CLAUDE_CLI_MODEL
        agent.current_model = CLAUDE_CLI_MODEL
    elif args == "lmstudio":
        from cli.lmstudio import LM_STUDIO_MODEL
        agent.current_model = LM_STUDIO_MODEL
    elif args == "llamacpp":
        from cli.llamacpp import LLAMA_DEFAULT_MODEL
        agent.current_model = LLAMA_DEFAULT_MODEL
        
    # Save config
    config = load_config()
    config.update({"backend": args, "model": agent.current_model})
    save_config(config)
    
    # Re-initialize
    agent.backend_initialized = False
    agent.new_session() # Clear session when switching backends
    agent.initialize_backend()
    
    console.print(f"[green]Switched to {get_friendly_backend_name(args)} backend.[/green]")
    agent.refresh_display()


def handle_sessions_command(agent: YipsAgentProtocol) -> None:
    """Handle /sessions command to interactively select and load a session."""
    sessions = get_session_list()
    if not sessions:
        console.print("[yellow]No session history found.[/yellow]")
        return

    # Set selection mode in agent
    agent.session_list = sessions
    agent.session_selection_idx = 0
    agent.session_selection_active = True
    
    # Refresh to show cursor in Recent activity cell
    agent.refresh_title_box_only()
    
    from prompt_toolkit.input import create_input
    from prompt_toolkit.keys import Keys

    # Capture keys
    input_obj = create_input()
    
    try:
        with input_obj.raw_mode():
            while True:
                # Read keys
                keys = input_obj.read_keys()
                for key_press in keys:
                    key = key_press.key
                    
                    if key == Keys.Up:
                        agent.session_selection_idx = (agent.session_selection_idx - 1) % len(sessions)
                        agent.refresh_title_box_only()
                    elif key == Keys.Down:
                        agent.session_selection_idx = (agent.session_selection_idx + 1) % len(sessions)
                        agent.refresh_title_box_only()
                    elif key == Keys.Enter or key == "\r" or key == "\n":
                        # Load session
                        selected_session = sessions[agent.session_selection_idx]
                        agent.session_selection_active = False
                        agent.load_session(selected_session['path'])
                        return
                    elif key == Keys.Escape:
                        agent.session_selection_active = False
                        agent.refresh_title_box_only()
                        return
                
                time.sleep(0.05)
    except Exception as e:
        agent.session_selection_active = False
        console.print(f"[red]Error in session selection: {e}[/red]")
        agent.refresh_title_box_only()


def handle_model_command(agent: YipsAgentProtocol, args: str) -> None:
    """Handle the /model command to display or switch models."""
    args = args.strip()

    # Claude models that switch to Claude CLI
    claude_models = {"haiku", "sonnet", "opus"}

    # Get available models
    lm_models = get_lm_models()
    llama_models = get_llama_models()

    if not args:
        # Display model table
        table = Table(title="Available Models")
        table.add_column("Model", style="cyan")
        table.add_column("Backend", style="magenta")
        table.add_column("Status", style="green")

        # Claude models
        for model in ["haiku", "sonnet", "opus"]:
            is_current = agent.use_claude_cli and agent.current_model == model
            status = "← current" if is_current else ""
            table.add_row(get_friendly_model_name(model), get_friendly_backend_name("claude"), status)

        # llama.cpp models
        for model in llama_models:
            is_current = not agent.use_claude_cli and agent.backend == "llamacpp" and agent.current_model == model
            status = "← current" if is_current else ""
            table.add_row(get_friendly_model_name(model), get_friendly_backend_name("llamacpp"), status)

        # LM Studio models
        for model in lm_models:
            is_current = not agent.use_claude_cli and agent.backend == "lmstudio" and agent.current_model == model
            status = "← current" if is_current else ""
            table.add_row(get_friendly_model_name(model), get_friendly_backend_name("lmstudio"), status)

        console.print(table)
        return

    # Switch model
    model_name_lower = args.lower()

    if model_name_lower in claude_models:
        # User requested switch - clean up first
        console.print("[dim]Cleaning up (unloading models and clearing session)...[/dim]")
        stop_llamacpp()
        unload_all_models()
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
            console.print("[dim]Cleaning up (unloading models and clearing session)...[/dim]")
            stop_llamacpp()
            unload_all_models()
            agent.new_session()
            
            agent.use_claude_cli = False
            agent.backend = "llamacpp"
            agent.current_model = matched
            config = load_config()
            config.update({"backend": "llamacpp", "model": matched, "verbose": agent.verbose_mode})
            save_config(config)
            console.print(f"[green]Switched to {get_friendly_backend_name('llamacpp')} with model: {get_friendly_model_name(matched)}[/green]")
            agent.refresh_display()

    elif args in lm_models or any(args.lower() in m.lower() for m in lm_models):
        # Find matching LM Studio model
        matched = args if args in lm_models else next(
            (m for m in lm_models if args.lower() in m.lower()), None
        )
        if matched:
            # User requested switch - clean up first
            console.print("[dim]Cleaning up (unloading models and clearing session)...[/dim]")
            stop_llamacpp()
            unload_all_models()
            agent.new_session()
            
            agent.use_claude_cli = False
            agent.backend = "lmstudio"
            agent.current_model = matched
            config = load_config()
            config.update({"backend": "lmstudio", "model": matched, "verbose": agent.verbose_mode})
            save_config(config)
            console.print(f"[green]Switched to {get_friendly_backend_name('lmstudio')} with model: {get_friendly_model_name(matched)}[/green]")
            agent.refresh_display()
        else:
            console.print(f"[red]Model not found: {args}[/red]")
    else:
        console.print(f"[red]Model not found: {args}[/red]")
        console.print("[dim]Use /model to see available models[/dim]")


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

    if command == "model":
        handle_model_command(agent, args)
        return True

    if command == "backend":
        handle_backend_command(agent, args)
        return True

    if command == "sessions":
        handle_sessions_command(agent)
        return True

    if command in ("clear", "new"):
        agent.new_session()
        return True

    if command == "verbose":
        # Toggle verbose mode
        agent.verbose_mode = not agent.verbose_mode
        config = load_config()
        config["verbose"] = agent.verbose_mode
        save_config(config)
        status = "enabled" if agent.verbose_mode else "disabled"
        console.print(f"[green]Verbose mode (Claude Code tool calls): {status}[/green]")
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
    available = []
    if TOOLS_DIR.exists():
        available.extend([d.name.lower() for d in TOOLS_DIR.iterdir() if d.is_dir()])
    if SKILLS_DIR.exists():
        available.extend([d.name.lower() for d in SKILLS_DIR.iterdir() if d.is_dir()])
    available.extend(["exit", "model", "backend", "verbose", "stream", "sessions", "clear", "new"])
    console.print(f"[dim]Available: /{', /'.join(sorted(list(set(available))))}[/dim]")
    return True


def handle_command(agent: YipsAgentProtocol, user_input: str) -> str | bool:
    """Unified command handler for all slash commands."""
    return handle_slash_command(agent, user_input)


