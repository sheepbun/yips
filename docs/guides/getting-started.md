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

Milestone 0 currently boots a strict TypeScript REPL foundation.

When you start Yips:

1. Yips loads `.yips_config.json` when available
2. Yips starts the bootstrap REPL loop
3. You can type messages to verify command parsing and loop behavior

The full split-pane TUI and llama.cpp integration are planned in upcoming milestones.

## First Conversation

Type a message and press Enter. In Milestone 0, Yips echoes the input back.

```
> hello

Yips: hello
```

## Basic Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
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

> Last updated: 2026-02-22
