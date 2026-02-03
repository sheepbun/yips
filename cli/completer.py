import ast
from pathlib import Path
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.formatted_text import FormattedText
from cli.config import COMMANDS_DIR, SKILLS_DIR, TOOLS_DIR
from cli.color_utils import (
    GRADIENT_PINK,
    GRADIENT_YELLOW,
    GRADIENT_BLUE,
    GRADIENT_BLUE_DARK,
    interpolate_color,
    PROMPT_COLOR
)


class SlashCommandCompleter(Completer):
    """
    Completer for Yips commands with gradient styling.
    Provides styled command text and pink-to-yellow gradient descriptions.
    All commands use the / prefix.
    """

    def _get_description(self, path: Path) -> str:
        """Extract description from a .py or .md file."""
        if path.suffix == ".py":
            try:
                tree = ast.parse(path.read_text())
                doc = ast.get_docstring(tree)
                if doc:
                    lines = [l.strip() for l in doc.split('\n') if l.strip()]
                    if lines:
                        # Try to find "Description: "
                        for line in lines:
                            if line.lower().startswith("description:"):
                                return line.split(":", 1)[1].strip()
                        # Or just use the first line, stripping "NAME - "
                        first_line = lines[0]
                        if " - " in first_line:
                            return first_line.split(" - ", 1)[1].strip()
                        return first_line
            except Exception:
                pass
            return "Tool command"
        
        elif path.suffix == ".md":
            try:
                content = path.read_text()
                lines = [l.strip() for l in content.split('\n') if l.strip()]
                # Skip the first header if it exists
                if lines:
                    if lines[0].startswith('#'):
                        if len(lines) > 1:
                            # Use first line after header if it doesn't start with ! (usage)
                            for line in lines[1:]:
                                if not line.startswith('!') and not line.startswith('#'):
                                    return line
                        return lines[0].lstrip('#').strip()
                    return lines[0]
            except Exception:
                pass
            return "Markdown skill"
            
        return "Command"

    def _get_words_and_meta(self):
        """
        Discover commands from SKILLS_DIR, TOOLS_DIR and built-ins.
        Returns: (list of words, meta_dict)
        """
        # 1. Built-in commands (default to tool style)
        all_items = {
            '/exit': {'desc': 'Exit the application', 'type': 'tool'},
            '/quit': {'desc': 'Exit the application', 'type': 'tool'},
            '/model': {'desc': 'Switch or list AI models', 'type': 'tool'},
            '/sessions': {'desc': 'Interactively select and load a session', 'type': 'tool'},
            '/clear': {'desc': 'Clear context and start a new session', 'type': 'tool'},
            '/new': {'desc': 'Start a new session', 'type': 'tool'},
            '/verbose': {'desc': 'Toggle verbose output', 'type': 'tool'},
            '/stream': {'desc': 'Toggle streaming responses', 'type': 'tool'}
        }

        # 2. Discover commands from directories
        for parent_dir in [TOOLS_DIR, SKILLS_DIR]:
            if parent_dir.exists():
                for d in parent_dir.iterdir():
                    if d.is_dir():
                        name = d.name.lower()
                        cmd_name = f"/{name}"
                        
                        py_file = d / f"{d.name}.py"
                        md_file = d / f"{d.name}.md"
                        
                        has_py = py_file.exists()
                        has_md = md_file.exists()
                        
                        # Don't overwrite built-ins with generic descriptions
                        if cmd_name in all_items and not (has_py or has_md):
                            continue

                        if has_py:
                            desc = self._get_description(py_file)
                            cmd_type = 'tool'
                        elif has_md:
                            desc = self._get_description(md_file)
                            cmd_type = 'skill'
                        else:
                            desc = "Command"
                            cmd_type = 'tool'
                            
                        # If it's a built-in, only overwrite if we got a good description
                        if cmd_name in all_items:
                            if desc not in ["Tool command", "Markdown skill", "Command"]:
                                all_items[cmd_name]['desc'] = desc
                                all_items[cmd_name]['type'] = cmd_type
                        else:
                            all_items[cmd_name] = {'desc': desc, 'type': cmd_type}

        words = sorted(all_items.keys())
        meta_dict = all_items

        return words, meta_dict

    def _create_command_formatted_text(self, text: str, cmd_type: str = 'skill') -> FormattedText:
        """Create command text with appropriate styling."""
        if cmd_type == 'skill':
            # Pink (#FFCCFF) for skills
            return FormattedText([('#ffccff', text)])
        else:
            # Solid Blue (#89CFF0) for tools
            return FormattedText([('#89cff0', text)])

    def _create_gradient_formatted_text(self, text: str) -> FormattedText:
        """Create gradient-colored text from pink to yellow with character-level control."""
        if not text:
            return FormattedText([])

        parts = []
        length = len(text)

        for i, char in enumerate(text):
            progress = i / max(length - 1, 1)
            r, g, b = interpolate_color(GRADIENT_PINK, GRADIENT_YELLOW, progress)
            style = f'fg:#{r:02x}{g:02x}{b:02x}'
            parts.append((style, char))

        return FormattedText(parts)

    def get_completions(self, document, complete_event):
        """Get completions for commands with styling."""
        # Get text before cursor (lstrip for leading whitespace)
        text_before_cursor = document.text_before_cursor.lstrip()

        # Only trigger if text starts with '/'
        if not text_before_cursor.startswith('/'):
            return

        # Stop if space detected (entering args)
        if ' ' in text_before_cursor:
            return

        # Get available commands
        words, meta_dict = self._get_words_and_meta()

        # Case-insensitive matching
        text_lower = text_before_cursor.lower()

        for command in words:
            if command.lower().startswith(text_lower):
                cmd_data = meta_dict.get(command, {'desc': '', 'type': 'tool'})
                
                # Styled command (pink for skills, blue gradient for tools)
                display = self._create_command_formatted_text(command, cmd_data['type'])

                # Styled description (gradient)
                description = cmd_data['desc']
                display_meta = self._create_gradient_formatted_text(description)

                # Calculate replacement position
                start_position = -len(text_before_cursor)

                # Yield completion with styling
                yield Completion(
                    text=command,
                    start_position=start_position,
                    display=display,
                    display_meta=display_meta
                )
