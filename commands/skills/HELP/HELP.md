# Yips Help

Welcome to **Yips**, your agentic desktop companion.

## Built-in Commands
- `/help` - Show this help message.
- `/model [name]` - List available models or switch to a specific model.
- `/sessions` - Interactively select and load a past session.
- `/clear` or `/new` - Start a new, empty conversation.
- `/verbose` - Toggle verbose mode (shows underlying tool calls).
- `/stream` - Toggle response streaming.
- `/exit` or `/quit` - Exit the Yips CLI.

## Skills & Tools
Yips can perform complex tasks using specialized skills and tools:
- `/search [query]` - Search the web for information.
- `/fetch [url]` - Retrieve content from a specific website.
- `/grab [file]` - Read a file's content into context.
- `/memorize [fact]` - Save a fact to long-term memory.
- `/todos` - List and manage project TODOs.
- `/build` - Run project build commands.
- `/vt` - Toggle the Virtual Terminal (also accessible via Shift+Tab).

## General Tips
- **Be Specific**: The more detail you provide in your requests, the better Yips can help.
- **Agentic Loop**: Yips can run multiple steps autonomously. Use `/verbose` to see what's happening under the hood.
- **Pivoting**: If Yips gets stuck or encounters errors, it will try to "pivot" and find an alternative solution.
- **Context Awareness**: Yips knows about your current directory, project structure, and past interactions.

For more information on a specific tool, try running it (e.g., `/search` without arguments often shows usage).
