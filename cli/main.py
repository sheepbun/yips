"""
Main entry point for Yips CLI.

Provides the main() function that initializes and runs the YipsAgent.
"""

import os
import subprocess

from prompt_toolkit import prompt as prompt_toolkit_prompt
from prompt_toolkit.formatted_text import HTML as HTMLText
from prompt_toolkit.styles import Style as PromptStyle

from cli.agent import YipsAgent
from cli.color_utils import console, print_yips, PROMPT_COLOR
from cli.commands import handle_slash_command
from cli.tool_execution import parse_tool_requests, execute_tool, clean_response


def main() -> None:
    """Main entry point for Yips CLI."""
    agent = YipsAgent()

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
            # Create custom style for prompt_toolkit input
            style = PromptStyle.from_dict({
                '': PROMPT_COLOR,  # Input text color (e.g., #FFCCFF)
            })
            # Use prompt_toolkit for styled input
            user_input = prompt_toolkit_prompt(
                HTMLText(f'<style fg="{PROMPT_COLOR}">>>> </style>'),
                style=style
            ).strip()
        except (EOFError, KeyboardInterrupt):
            agent.graceful_exit()
            break

        if not user_input:
            continue

        # Handle slash commands first
        slash_result = handle_slash_command(agent, user_input)
        if slash_result == "exit":
            break
        if slash_result:
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
        for request in tool_requests:
            result = execute_tool(request)
            console.print(f"[dim]{result}[/dim]")
            agent.conversation_history.append({
                "role": "system",
                "content": result
            })

        # Final break line after response
        console.print()


if __name__ == "__main__":
    main()
