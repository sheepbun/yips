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
    """Recursively process response, execute tools, and handle reprompts."""
    if depth > 10:  # Prevent infinite loops
        console.print("[red]Max reprompt depth reached.[/red]")
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
    
    # Show a summary line for the batch
    if depth == 0:
        console.print()
        console.print(blue_gradient_text(f"⚡ Executing {total_requests} tool call{'s' if total_requests != 1 else ''}..."))

    for i, request in enumerate(tool_requests, 1):
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
            tool_name = f"skill:{request['skill']}"
            params = request["args"]

        # Display tool with Live for running state
        prefix = f"({i}/{total_requests})" if total_requests > 1 else "▶"
        if depth > 0:
            prefix = f"↻ {prefix}"
            
        display_name = f"{prefix} {tool_name}"
        
        # Add a tiny delay before starting next tool for visual separation
        if i > 1:
            time.sleep(0.3)

        console.print()
        with Live(render_tool_call(display_name, params, is_running=True), console=console, refresh_per_second=10, transient=True) as live:
            # Execute the tool
            result = execute_tool(request, agent)
            
            # Update with final result
            final_panel = render_tool_call(display_name, params, result=result)
        
        # Print the final persistent panel
        console.print(final_panel)
        
        # Handle special command results
        if result == "::YIPS_EXIT::":
            sys.exit(0)
            
        # Store in history
        agent.conversation_history.append({
            "role": "system",
            "content": result
        })

        # Check for REPROMPT (special case)
        if isinstance(result, str) and result.startswith("::YIPS_REPROMPT::"):
            reprompt_msg = result[17:]
            if reprompt_msg:
                # Add to history
                agent.conversation_history.append({
                    "role": "user",
                    "content": reprompt_msg
                })
                
                # Recursive call for the reprompt
                next_response = agent.get_response(reprompt_msg)
                agent.conversation_history.append({
                    "role": "assistant",
                    "content": next_response
                })
                
                process_response_and_tools(agent, next_response, depth + 1)
                return # Stop processing current batch as we've chained


def main() -> None:
    """Main entry point for Yips CLI."""
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

    # Clear terminal
    subprocess.run('clear' if os.name != 'nt' else 'cls', shell=True)

    # Render the title box
    agent.render_title_box()

    # Initialize backend after displaying UI
    agent.initialize_backend()

    while True:
        # Check for pending resize
        if agent.resize_pending:
            agent.resize_pending = False
            agent.last_width = agent.console.width
            agent.refresh_display()

        try:
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
