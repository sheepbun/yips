"""
Main entry point for Yips CLI.

Provides the main() function that initializes and runs the YipsAgent.
"""

import os
import sys
import subprocess
from typing import Any

from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML as HTMLText
from prompt_toolkit.styles import Style as PromptStyle
from prompt_toolkit.key_binding import KeyBindings
import time
from rich.live import Live
from rich.text import Text

from cli.agent import YipsAgent
from cli.ui_rendering import (
    render_top_border,
    render_bottom_border,
    render_tool_call,
    render_tool_batch,
)
from cli.color_utils import (
    console,
    print_yips,
    PROMPT_COLOR,
    TOOL_COLOR,
    blue_gradient_text,
)
from cli.commands import handle_command
from cli.config import COMMANDS_DIR
from cli.tool_execution import parse_tool_requests, execute_tool, clean_response
from cli.completer import SlashCommandCompleter


def process_response_and_tools(agent: YipsAgent, response: str, depth: int = 0) -> None:
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
    tool_history: list[dict] = []
    summary_text = ""
    if depth == 0:
        summary_text = f"⚡ Executing {total_requests} tool call{'s' if total_requests != 1 else ''}..."
    else:
        summary_text = f"↻ Executing {total_requests} additional tool call{'s' if total_requests != 1 else ''}..."

    has_reprompt = False
    reprompt_msg = ""
    
    with Live(render_tool_batch(tool_history, summary_text, compact=True), console=console, refresh_per_second=10, transient=False) as live:
        for i, request in enumerate(tool_requests, 1):
            # ... (lines omitted for brevity but logic remains same)
            # Handle pseudo-tool THOUGHT (updates agent state)
            if request["type"] == "thought":
                agent.session_state["thought_signature"] = request["signature"]
                continue

            # Get tool name and params
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

            # Display tool with prefix
            prefix = f"({i}/{total_requests})" if total_requests > 1 else "▶"
            display_name = f"{prefix} {tool_name}"
            
            # Add to history for batch rendering
            current_tool_info = {
                "name": display_name,
                "params": params,
                "is_running": True,
                "result": None
            }
            tool_history.append(current_tool_info)
            live.update(render_tool_batch(tool_history, summary_text, compact=True))
            
            # Add a tiny delay before starting next tool for visual separation
            if i > 1:
                time.sleep(0.3)

            # Execute the tool
            result = execute_tool(request, agent)
            
            # Update tool info with result
            current_tool_info["is_running"] = False
            current_tool_info["result"] = result
            live.update(render_tool_batch(tool_history, summary_text, compact=True))
            
            # ... (rest of the loop)
            # Update error tracking
            if isinstance(result, str) and ("[Error" in result or "failed" in result.lower()):
                agent.session_state["error_count"] = agent.session_state.get("error_count", 0) + 1
            else:
                agent.session_state["error_count"] = 0 # Reset on success
            
            agent.session_state["last_action"] = f"{tool_name}: {params}"
            
            # Update metrics
            try:
                from cli.config import DOT_YIPS_DIR
                import json
                metrics_path = DOT_YIPS_DIR / "metrics.json"
                if metrics_path.exists():
                    metrics = json.loads(metrics_path.read_text())
                    metrics["total_actions"] = metrics.get("total_actions", 0) + 1
                    if not (isinstance(result, str) and ("[Error" in result or "failed" in result.lower())):
                        metrics["successes"] = metrics.get("successes", 0) + 1
                    metrics_path.write_text(json.dumps(metrics, indent=2))
            except Exception:
                pass
            
            # Handle special command results
            if result == "::YIPS_EXIT::":
                sys.exit(0)
                
            # Store structured tool call in history
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

            # Check for REPROMPT (special case)
            if isinstance(result, str) and result.startswith("::YIPS_REPROMPT::"):
                has_reprompt = True
                reprompt_msg = result[17:]

        # Final update to show all tools in the batch once completed
        live.update(render_tool_batch(tool_history, summary_text, compact=False))

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
    def _(event):
        """Handle Enter key. Do not submit if empty."""
        buffer = event.current_buffer
        if not buffer.text.strip():
            return
        
        buffer.validate_and_handle()

    @bindings.add('s-tab')
    def _(event):
        """Toggle Virtual Terminal with Shift+Tab"""
        vt_path = COMMANDS_DIR / "VT" / "VT.py"
        if vt_path.exists():
            try:
                # Suspend the current application to run the subprocess
                with event.app.suspend_to_background():
                    subprocess.run([sys.executable, str(vt_path)])
            except Exception as e:
                console.print(f"[Error launching VT: {e}]")

    # Initialize PromptSession
    session = PromptSession(
        style=style,
        completer=completer,
        complete_while_typing=True,
        key_bindings=bindings
    )

    # Create agent and pass session reference
    agent = YipsAgent(prompt_session=session)

    is_gui = os.environ.get("YIPS_GUI_MODE") == "1"

    if not is_gui:
        # Clear terminal
        subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)

        # Render the title box
        agent.render_title_box()

    # Initialize backend after displaying UI
    agent.initialize_backend()

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
            else:
                # Use PromptSession for input
                user_input = session.prompt(
                    HTMLText(f'<style fg="{PROMPT_COLOR}">>>> </style>'),
                    complete_while_typing=True
                ).strip()
        except (EOFError, KeyboardInterrupt):
            agent.graceful_exit()
            sys.exit(0)

        if not user_input:
            continue

        # Update user intervention metrics
        try:
            from cli.config import DOT_YIPS_DIR
            import json
            metrics_path = DOT_YIPS_DIR / "metrics.json"
            if metrics_path.exists():
                metrics = json.loads(metrics_path.read_text())
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

if __name__ == "__main__":
    main()
