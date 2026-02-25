# Yips Documentation

Yips is a local-first AI code editor and self-hosted gateway. It runs language models on your hardware, gives them tools to read, write, and execute code, and keeps your data entirely under your control. The project is a ground-up rewrite of [yips-cli](../../yips-cli/) — moving from a Python CLI to a TypeScript terminal UI.

> **Project status**: Early development. The TypeScript TUI is being built from scratch; see [roadmap.md](./roadmap.md) for milestones and [rewrite.md](./rewrite.md) for migration details.

## Start Here

- [Overview](./overview.md) — vision, principles, and key concepts
- [Getting Started](./guides/getting-started.md) — installation and first run

## Documentation Map

### Core

| Document | Description |
|----------|-------------|
| [Overview](./overview.md) | Vision, design principles, what Yips does and does not do |
| [Architecture](./architecture.md) | System components, request flow, tool protocol |
| [Project Tree](./project-tree.md) | Canonical source/test tree and import alias map |
| [Roadmap](./roadmap.md) | Phased milestones, decision log |

### Developer

| Document | Description |
|----------|-------------|
| [Rewrite Guide](./rewrite.md) | yips-cli → yips TUI migration plan |
| [Tech Stack](./stack.md) | Decided and open technology choices |
| [Changelog](./changelog.md) | Version history (Keep a Changelog format) |
| [Progress Log](./progress-log.md) | Progress-log index with per-exchange files under `./progress-log/YYYY/MM/DD/` |

### Guides

| Document | Description |
|----------|-------------|
| [Getting Started](./guides/getting-started.md) | Prerequisites, installation, first run |
| [CODE.md](./guides/code-md.md) | Project brief format for the AI agent |
| [Slash Commands](./guides/slash-commands.md) | Command reference and tab completion |
| [Hooks](./guides/hooks.md) | Lifecycle hooks and custom scripts |
| [MCP Integration](./guides/mcp.md) | Status note: MCP integration is intentionally skipped |
| [Gateway](./guides/gateway.md) | Self-hosted messaging gateway |

### Community

| Document | Description |
|----------|-------------|
| [Contributing](./contributing.md) | Setup, code standards, PR process |

---

> Last updated: 2026-02-25
