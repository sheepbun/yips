#!/usr/bin/env python3
"""
VT - Virtual Terminal Skill for Yips

This skill provides a box-bordered virtual terminal interface
where the user can execute bash commands.
"""

import os
import sys
import subprocess
from prompt_toolkit.application import Application
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout.containers import Window, HSplit
from prompt_toolkit.layout.controls import BufferControl
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.widgets import TextArea, Frame
from prompt_toolkit.styles import Style
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.document import Document
from prompt_toolkit.filters import Condition

def main():
    # Determine the project root to set PYTHONPATH correctly if needed
    # (Though usually inherited from the caller)
    
    # Output buffer to show command results
    output_field = TextArea(style='class:output-field', focusable=False, scrollbar=True)
    
    # Input buffer for user commands
    input_field = TextArea(
        height=1,
        prompt='bash$ ',
        style='class:input-field',
        multiline=False,
        wrap_lines=False,
    )

    def accept_text(buff):
        command = input_field.text.strip()
        if not command:
            return True

        if command in ('exit', 'quit'):
            app.exit()
            return False

        # Display command in output
        new_text = output_field.text + f"\n$ {command}\n"
        output_field.buffer.document = Document(new_text, cursor_position=len(new_text))

        try:
            # Run command
            # We use subprocess.run to capture output.
            # Note: Interactive commands (like vim) might not work well in this simple VT 
            # without more complex PTY handling.
            # For "back in bash", simple execution is a start.
            process = subprocess.run(
                command,
                shell=True,
                executable='/bin/bash',
                capture_output=True,
                text=True
            )
            
            output = process.stdout
            if process.stderr:
                output += f"\nstderr:\n{process.stderr}"
                
            new_text = output_field.text + output + "\n"
            output_field.buffer.document = Document(new_text, cursor_position=len(new_text))
            
        except Exception as e:
            new_text = output_field.text + f"Error: {e}\n"
            output_field.buffer.document = Document(new_text, cursor_position=len(new_text))

        return True  # Keep text in buffer? No, usually we clear.

    # Hook the accept handler manually because TextArea doesn't expose it easily in constructor for this use case
    # actually input_field.accept_handler is what we want
    def handle_accept(buff):
        accept_text(buff)
        # Clear input
        input_field.buffer.reset() 
        return False # Don't keep focus? Wait. 

    input_field.accept_handler = handle_accept

    # Layout
    root_container = Frame(
        HSplit([
            output_field,
            Window(height=1, char='-'), # Separator
            input_field,
        ]),
        title="Yips Virtual Terminal (Shift+Tab to exit/toggle)",
    )

    layout = Layout(root_container)

    # Key bindings
    kb = KeyBindings()

    @kb.add('c-c')
    def _(event):
        """Control-C to exit"""
        event.app.exit()
    
    @kb.add('s-tab')
    def _(event):
        """Shift+Tab to exit (toggle back)"""
        event.app.exit()

    # Style
    style = Style.from_dict({
        'output-field': '#00ff00',
        'input-field': '#ffffff bold',
        'frame.label': '#ff00ff bold',
        'frame.border': '#888888',
    })

    # Application
    app = Application(
        layout=layout,
        key_bindings=kb,
        style=style,
        full_screen=True,
        mouse_support=True,
    )

    app.run()

if __name__ == "__main__":
    main()
