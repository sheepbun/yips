# Getting Started

## Prerequisites

- **Node.js** 20 or later
- **Git** for cloning the repository and project-level features
- **GPU toolkit** (optional, recommended): CUDA (NVIDIA) or Metal (macOS) for local model inference via llama.cpp. CPU-only mode works but is significantly slower.

## Installation

### From source (development)

```sh
git clone https://github.com/sheepbun/yips.git
cd yips
```

```sh
# Install dependencies
npm install

# Build
npm run build

# Run compiled output
npm start

# Or run directly in development mode
npm run dev
```

## First Run

Yips now boots the Ink-based TUI by default in interactive terminals.

When you start Yips:

1. Yips loads `.yips_config.json` when available
2. Yips opens the interactive TUI (title header, conversation pane, and prompt composer)
3. Yips routes slash commands locally and sends regular messages to the configured llama.cpp-compatible chat endpoint

Use `--no-tui` or pipe input to force REPL fallback mode.

## First Conversation

Type a message and press Enter. With backend `llamacpp`, Yips sends your in-memory conversation history to `/v1/chat/completions` and renders the response in the output pane.

```
> hello

Yips: Hi there! How can I help?
```

## Basic Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model` | Show or set active model name |
| `/stream` | Toggle token streaming on/off |
| `/clear` or `/new` | Reset the current conversation session |
| `/exit` or `/quit` | Exit Yips |

See [Slash Commands](./slash-commands.md) for the planned full command reference.

## Setting Up a Project with CODE.md

To give Yips context about a specific project, create a `CODE.md` file in the project root:

```sh
cd /path/to/your/project
touch CODE.md
```

Then add your project's name, tech stack, directory structure, and any conventions the agent should follow. See the [CODE.md Guide](./code-md.md) for format details and examples.

When you run Yips from a directory containing `CODE.md`, the file is loaded into the agent's system prompt automatically.

## Next Steps

- [CODE.md Guide](./code-md.md) — write a project brief for the agent
- [Slash Commands](./slash-commands.md) — full command reference
- [Overview](../overview.md) — vision and design principles
- [Architecture](../architecture.md) — how the system works

---

> Last updated: 2026-02-23
