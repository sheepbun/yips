from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.formatted_text import FormattedText
from cli.config import COMMANDS_DIR, SKILLS_DIR, TOOLS_DIR
from cli.color_utils import GRADIENT_PINK, GRADIENT_YELLOW, interpolate_color, PROMPT_COLOR


class SlashCommandCompleter(Completer):
    """
    Completer for Yips commands with gradient styling.
    Provides pink command text and pink-to-yellow gradient descriptions.
    All commands use the / prefix.
    """

    def _get_words_and_meta(self):
        """
        Discover commands from SKILLS_DIR, TOOLS_DIR and built-ins.
        Returns: (list of words, meta_dict)
        """
        # 1. Built-in commands
        all_items = {
            '/exit': 'Exit the application',
            '/quit': 'Exit the application',
            '/model': 'Switch or list AI models',
            '/sessions': 'Interactively select and load a session',
            '/verbose': 'Toggle verbose output',
            '/stream': 'Toggle streaming responses'
        }

        # 2. Discover commands from directories
        for parent_dir in [TOOLS_DIR, SKILLS_DIR]:
            if parent_dir.exists():
                for d in parent_dir.iterdir():
                    if d.is_dir():
                        name = d.name.lower()
                        
                        has_py = (d / f"{d.name}.py").exists()
                        has_md = (d / f"{d.name}.md").exists()
                        
                        if has_py and has_md:
                            desc = "Tool & Skill"
                        elif has_py:
                            desc = "Tool command"
                        elif has_md:
                            desc = "Markdown skill"
                        else:
                            desc = "Command"
                            
                        all_items[f"/{name}"] = desc

        words = sorted(all_items.keys())
        meta_dict = all_items

        return words, meta_dict

    def _create_command_formatted_text(self, text: str) -> FormattedText:
        """Create command text in pink (#FFCCFF)."""
        return FormattedText([('fg:#FFCCFF', text)])

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
                # Styled command (pink)
                display = self._create_command_formatted_text(command)

                # Styled description (gradient)
                description = meta_dict.get(command, "")
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

