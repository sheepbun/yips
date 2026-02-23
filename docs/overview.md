# Overview

## Vision

Yips is a local-first AI assistant that runs on your machine and stays under your control. It pairs a terminal-based code editor with a self-hosted gateway _(planned)_ that bridges AI agents to messaging platforms. The goal is full autonomy over your AI tooling — no cloud dependency, no subscription, no data leaving your hardware unless you choose otherwise.

## Design Principles

1. **Local-first**: Models run on your GPU via llama.cpp. Your files, conversations, and memory stay on your filesystem. Cloud backends exist as an opt-in fallback, not a default.

2. **Unix philosophy**: Small, composable pieces. Slash commands, tools, and skills are standalone units that the agent orchestrates. Configuration is plain files you can read and edit.

3. **Autonomy with transparency**: The agent executes file operations, commands, and skills without asking for permission on every step. It reports what it did, not what it is about to do. Destructive operations require explicit confirmation.

4. **Zero-config defaults**: `clone → run` should work. Yips detects your hardware, picks a model that fits your VRAM, and starts a conversation. Every setting has a sensible default; configuration is optional refinement.

5. **Truth via tools**: The agent's internal knowledge is static and may be outdated. When it uses a tool — search, file read, command output — the returned information is the ground truth for the current context.

6. **Privacy first**: User data stays on the user's system. No telemetry, no remote logging, no external API calls unless the user explicitly configures a cloud backend.

## What Yips Does

### AI Code Editor (TUI)

A terminal application for working with an AI agent on code. The agent can:

- Read, write, and edit files in your project
- Run shell commands and interpret output
- Search the web for current information
- Manage long-term memory across sessions
- Stream responses token-by-token with real-time display
- Switch between local models and cloud backends on the fly

### Self-Hosted Gateway _(planned)_

A service that connects the same AI agent to messaging platforms (WhatsApp, Telegram, Discord). Messages arrive through platform adapters, pass through a gateway core, and reach the same Conductor/Subagent system that powers the TUI. See [Gateway Guide](./guides/gateway.md) for details.

## What Yips Is Not

- **Not SaaS**: There is no hosted version. You run it on your hardware.
- **Not an IDE plugin**: Yips is a standalone TUI, not an extension for VS Code or Neovim.
- **Not a single-API wrapper**: Yips manages its own model lifecycle (download, serve, switch) rather than proxying requests to one provider.
- **Not a chatbot framework**: The gateway _(planned)_ bridges a full agent system to messaging platforms — it is not a template for building chatbots.

## Key Concepts

| Concept | Description | Details |
|---------|-------------|---------|
| **Conductor** | The top-level agent that receives user input, plans actions, and delegates to Subagents _(planned)_ | [Architecture](./architecture.md) |
| **Subagent** | A focused worker spawned by the Conductor for a specific subtask _(planned)_ | [Architecture](./architecture.md) |
| **CODE.md** | A project brief placed in a repository root; loaded into the agent's context at session start | [CODE.md Guide](./guides/code-md.md) |
| **Slash commands** | User-facing commands (`/model`, `/stream`, `/exit`) executed directly in the TUI | [Slash Commands](./guides/slash-commands.md) |
| **Tools** | Agent-facing actions (file read/write, grep, git, shell) parsed from response text and executed autonomously | [Architecture](./architecture.md) |
| **Skills** | Higher-level capabilities (search, fetch, memorize, build) invoked by the agent via `INVOKE_SKILL` | [Architecture](./architecture.md) |
| **Hooks** | User-defined scripts that run at lifecycle points (e.g., pre-commit analysis) _(planned)_ | [Hooks Guide](./guides/hooks.md) |
| **Gateway** | Self-hosted service bridging AI agents to messaging platforms _(planned)_ | [Gateway Guide](./guides/gateway.md) |

---

> Last updated: 2026-02-22
