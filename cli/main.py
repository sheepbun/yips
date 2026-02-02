"""
Main entry point for Yips CLI.

Provides the main() function that initializes and runs the YipsAgent.
"""

import os
import sys
import subprocess

from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML as HTMLText
from prompt_toolkit.styles import Style as PromptStyle
from prompt_toolkit.key_binding import KeyBindings

from cli.agent import YipsAgent
from cli.color_utils import console, print_yips, PROMPT_COLOR, TOOL_COLOR
from cli.commands import handle_slash_command
from cli.config import SKILLS_DIR
from cli.tool_execution import parse_tool_requests, execute_tool, clean_response
from cli.completer import SlashCommandCompleter


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
        vt_path = SKILLS_DIR / "VT.py"
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
        # Check for pending resize - always refresh on any dimension change
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
        slash_result = handle_slash_command(agent, user_input)
        if slash_result == "exit":
            sys.exit(0)
        if isinstance(slash_result, str) and slash_result.startswith("::YIPS_REPROMPT::"):
            # Extract reprompt message and process it as a new user input
            reprompt_msg = slash_result[17:]  # Remove "::YIPS_REPROMPT::" prefix
            if reprompt_msg:
                user_input = reprompt_msg
                # Fall through to process as normal message
            else:
                continue
        elif slash_result:
            continue

        # Store user message
        agent.conversation_history.append({
            "role": "user",
            "content": user_input
        })

        # Get response from LM Studio
        response = agent.get_response(user_input)

        # Store assistant response
        agent.conversation_history.append({
            "role": "assistant",
            "content": response
        })

        # Parse tool requests
        tool_requests = parse_tool_requests(response)

        # Display cleaned response with gradient
        cleaned = clean_response(response)
        if cleaned:
            # Always print if streaming is disabled OR if it's an error/special message
            if not agent.streaming_enabled or response.startswith("["):
                print_yips(cleaned)

        # Execute tool requests autonomously
        total_requests = len(tool_requests)
        if total_requests > 0:
            console.print(f"[{TOOL_COLOR}]Queued {total_requests} tool call{'s' if total_requests != 1 else ''}[/{TOOL_COLOR}]")

        for i, request in enumerate(tool_requests, 1):
            # Get tool name for display
            tool_name = "unknown"
            if request["type"] == "action":
                tool_name = request["tool"]
            elif request["type"] == "identity":
                tool_name = "update_identity"
            elif request["type"] == "skill":
                tool_name = f"skill:{request['skill']}"

            remaining = total_requests - i
            console.print(f"[{TOOL_COLOR}]{tool_name}[/{TOOL_COLOR}]")
            if remaining > 0:
                console.print(f"[{TOOL_COLOR}](+ {remaining} tool call{'s' if remaining != 1 else ''})[/{TOOL_COLOR}]")

            result = execute_tool(request, agent)
            if result == "::YIPS_EXIT::":
                sys.exit(0)
            if isinstance(result, str) and result.startswith("::YIPS_REPROMPT::"):
                # Extract reprompt message and queue it for processing
                reprompt_msg = result[17:]  # Remove "::YIPS_REPROMPT::" prefix
                if reprompt_msg:
                    # Add to conversation history
                    agent.conversation_history.append({
                        "role": "system",
                        "content": f"[Reprompt requested: {reprompt_msg}]"
                    })
                    # Process the reprompt as a new message
                    agent.conversation_history.append({
                        "role": "user",
                        "content": reprompt_msg
                    })
                    response = agent.get_response(reprompt_msg)
                    agent.conversation_history.append({
                        "role": "assistant",
                        "content": response
                    })
                    # Parse and display the reprompt response
                    new_tool_requests = parse_tool_requests(response)
                    cleaned = clean_response(response)
                    if cleaned:
                        if not agent.streaming_enabled or response.startswith("["):
                            print_yips(cleaned)
                    # Execute any tool requests from the reprompt response
                    for new_request in new_tool_requests:
                        new_result = execute_tool(new_request, agent)
                        if new_result == "::YIPS_EXIT::":
                            sys.exit(0)
                        if not new_result.startswith("::YIPS_"):
                            console.print(new_result, style=TOOL_COLOR)
                            agent.conversation_history.append({
                                "role": "system",
                                "content": new_result
                            })
                continue
            console.print(result, style=TOOL_COLOR)
            agent.conversation_history.append({
                "role": "system",
                "content": result
            })

        # Update session memory file with current conversation
        agent.update_session_file()

if __name__ == "__main__":
    main()
