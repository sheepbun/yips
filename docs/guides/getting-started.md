# Getting Started

## Prerequisites

- **Node.js** 20 or later
- **Git** for cloning the repository and project-level features
- **GPU toolkit** (optional, recommended): CUDA (NVIDIA) or Metal (macOS) for local model inference via llama.cpp. CPU-only mode works but is significantly slower.

## Installation

### Automated local install (recommended)

```sh
git clone https://github.com/sheepbun/yips.git
cd yips
./install.sh
source ~/.yips/env.sh
npm run dev
```

What `install.sh` does:

- Installs required system dependencies (`git`, `cmake`, build tools, `node`, `npm`, `curl`) using `apt`/`dnf`/`brew` when needed
- Clones or updates `~/llama.cpp`, builds `llama-server` (CUDA when available, CPU fallback)
- Creates `~/.yips/models` and writes runtime exports to `~/.yips/env.sh`
- Installs Node dependencies for Yips (`npm install`)
- Creates or patches `.yips_config.json` with llama lifecycle defaults without overwriting existing user settings

If no GGUF model exists yet, open Yips and use `/download` or `/model` to fetch/select one.

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

## Multiline Key Troubleshooting

Yips uses this contract in the TUI prompt:

- `Enter` submits
- `Ctrl+Enter` inserts a newline

If `Ctrl+Enter` submits instead of inserting a newline on your terminal, first capture key parsing output:

```sh
YIPS_DEBUG_KEYS=1 npm run dev
```

Then press `Enter` and `Ctrl+Enter` in the prompt and compare the emitted `[debug stdin]` lines. If both look like plain carriage return (`<CR>` / `0d`) submit events, your terminal is not sending a distinct modified-enter sequence.

You can also run:

```text
/keys
```

inside Yips for built-in diagnostics guidance.

### Alacritty Example Mapping

If you use Alacritty, map `Ctrl+Enter` to CSI-u so Yips can detect newline input distinctly:

```toml
[keyboard]
bindings = [
  { key = "Enter", mods = "Control", chars = "\u001b[13;5u" }
]
```

After updating config, restart Alacritty and re-run `YIPS_DEBUG_KEYS=1 npm run dev` to confirm `Ctrl+Enter` now parses as `newline`.

If your setup still reports plain `CR` submit for `Ctrl+Enter`, try this alternate mapping (also supported by Yips):

```toml
[keyboard]
bindings = [
  { key = "Enter", mods = "Control", chars = "\u001b[13;5~" }
]
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

> Last updated: 2026-02-24
