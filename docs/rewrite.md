# Rewrite Guide: yips-cli → yips TUI

## Why Rewrite

The Python CLI (yips-cli) proved the concept — a local-first AI agent with autonomous tool use, streaming, model management, and session memory. But the architecture hit limits that incremental changes cannot fix:

- **No persistent layout**: Rich's `Live` display is transient. There is no stable split-pane layout with a fixed input area, scrollable output, and persistent status bar. Every render is a full repaint.
- **No split panes**: Showing the virtual terminal alongside the conversation requires a real TUI framework, not line-by-line terminal output.
- **Limited type safety**: Python's type hints are advisory. The tool protocol is string-based tag parsing with regex — fragile and hard to extend.
- **Single-agent bottleneck**: The conversation loop is a single function that does context loading, LLM calls, response parsing, tool execution, and display. Extracting a Conductor/Subagent architecture from this is harder than building it fresh.

A TypeScript TUI gives us persistent layout (Ink/blessed), strict types, a structured tool protocol, and a clean separation between Conductor, Subagents, and the display layer.

## What Carries Over

These concepts transfer directly from yips-cli to the TypeScript rewrite. The implementation will change, but the user-facing behavior and design intent remain the same.

| Concept | yips-cli Implementation | Carries Over As |
|---------|------------------------|-----------------|
| Local-first | llama.cpp subprocess, CUDA support | Same — llama.cpp primary backend |
| Slash commands | `/model`, `/stream`, `/exit`, etc. parsed in `commands.py` | Same command vocabulary, new dispatch system |
| Tool protocol | `{ACTION:tool:params}` text tags | Structured protocol (JSON tool calls or function calling) |
| Autonomous execution | Tool requests executed without confirmation by default | Same policy, new execution layer |
| Destructive command detection | Regex pattern list in `tool_execution.py` | Same safety patterns |
| Context loading | `context.py` assembles system prompt from AGENT.md, IDENTITY.md, memories, etc. | Same sources, plus CODE.md |
| Sessions | JSON conversation files, `/sessions` picker | Same concept, new storage format TBD |
| Memory | `MEMORIZE` skill saves to `memories/` | Same concept, integrated into Conductor |
| Streaming | SSE parsing, token-by-token gradient display | Same UX, new rendering layer |
| Model management | `/model`, `/download`, hardware-aware selection | Same features, new UI |
| Skills | Python scripts in `commands/skills/` and `commands/tools/` | TypeScript modules or MCP servers |

## What Changes

| Aspect | yips-cli | yips (TypeScript TUI) |
|--------|----------|----------------------|
| Language | Python 3 | TypeScript (strict mode) |
| Runtime | CPython | Node.js |
| Display | Rich (Live, Panel, Tree, gradient) | TUI framework (Ink, blessed, or terminal-kit — TBD) |
| Agent model | Single conversation loop | Conductor + Subagents |
| Tool protocol | Text tags parsed with regex | Structured protocol (JSON) |
| Layout | Transient line-by-line output | Persistent panes (input, output, status) |
| Configuration | `.yips_config.json` (flat JSON) | Format TBD (JSON, TOML, or YAML) |
| Skill system | Python scripts executed as subprocesses | TypeScript modules, possibly MCP servers |
| Identity system | `IDENTITY.md` + `UPDATE_IDENTITY` tag | TBD — may simplify or integrate into memory |

## Migration Checklist

Every yips-cli feature, with its migration status.

| Feature | yips-cli Source | Status |
|---------|----------------|--------|
| REPL conversation loop | `AGENT.py` | Not started |
| Context loading (AGENT.md, IDENTITY.md, memories) | `cli/agent/context.py` | Not started |
| llama.cpp backend | `cli/llamacpp.py` | Not started |
| Claude CLI backend | `cli/agent/backends.py` | Not started |
| Streaming display | `cli/agent/streaming.py` | Not started |
| Tool request parsing | `cli/tool_execution.py` | Not started |
| Tool execution (file ops, shell, git, grep) | `cli/tool_execution.py` | Not started |
| Destructive command detection | `cli/tool_execution.py` | Not started |
| Working zone enforcement | `cli/tool_execution.py` | Not started |
| Slash command dispatch | `cli/commands.py` | Not started |
| `/model` — model manager UI | `cli/model_manager.py` | Not started |
| `/download` — model downloader | `cli/download_ui.py` | Not started |
| `/backend` — backend switching | `cli/commands.py` | Not started |
| `/sessions` — session picker | `cli/commands.py` | Not started |
| `/stream` — toggle streaming | `cli/commands.py` | Not started |
| `/verbose` — toggle verbose mode | `cli/commands.py` | Not started |
| `/clear`, `/new` — new session | `cli/commands.py` | Not started |
| `/nick` — model nicknames | `cli/commands.py` | Not started |
| `/exit`, `/quit` — graceful exit | `cli/commands.py` | Not started |
| SEARCH skill | `commands/skills/SEARCH/` | Not started |
| FETCH skill | `commands/tools/FETCH/` | Not started |
| BUILD skill | `commands/tools/BUILD/` | Not started |
| MEMORIZE skill | `commands/tools/MEMORIZE/` | Not started |
| RENAME skill | `commands/tools/RENAME/` | Not started |
| TODOS skill | `commands/tools/TODOS/` | Not started |
| GRAB skill | `commands/tools/GRAB/` | Not started |
| VT (Virtual Terminal) | `commands/tools/VT/` | Not started |
| SUMMARY skill | `commands/tools/SUMMARY/` | Not started |
| FOCUS skill | `commands/tools/FOCUS/` | Not started |
| REPROMPT skill | `commands/tools/REPROMPT/` | Not started |
| EXIT skill | `commands/tools/EXIT/` | Not started |
| HELP skill | `commands/skills/HELP/` | Not started |
| CREATE_SKILL skill | `commands/tools/CREATE_SKILL/` | Not started |
| INSTALL_HOOKS skill | `commands/tools/INSTALL_HOOKS/` | Not started |
| LEARN skill | `commands/tools/LEARN/` | Not started |
| Identity updates | `cli/tool_execution.py` | Not started |
| Thought signatures | `cli/tool_execution.py` | Not started |
| Plan creation | `cli/tool_execution.py` | Not started |
| Gradient text rendering | `cli/color_utils.py` | Not started |
| Title box UI | `cli/ui_rendering.py` | Not started |
| Tab autocompletion | `cli/commands.py` (completer) | Not started |
| Configuration persistence | `cli/config.py` | Not started |
| Hardware detection | `cli/hw_utils.py` | Not started |
| Version display | `cli/version.py` | Not started |
| Pre-commit hook | `git_hooks/pre-commit` | Not started |
| CODE.md support | — (new in TypeScript rewrite) | Not started |
| Conductor/Subagent architecture | — (new in TypeScript rewrite) | Not started |
| MCP client | — (new in TypeScript rewrite) | Not started |
| Gateway | — (new in TypeScript rewrite) | Not started |

## yips-cli Reference

Key file paths for tracing features back to the Python source.

```
yips-cli/
├── AGENT.py                        # Main entry point, conversation loop
├── AGENT.md                        # Soul document (personality, principles, tool protocol)
├── IDENTITY.md                     # Evolving self-understanding
├── SPECIFICATIONS.md               # System architecture diagram, tool protocol spec
├── ARCHITECTURE_DIAGRAM.md         # Streaming architecture, request flow
├── CHANGELOG_YIPS.md               # Version history
├── cli/
│   ├── agent/
│   │   ├── context.py              # Context loading (system prompt assembly)
│   │   ├── backends.py             # Backend abstraction
│   │   └── streaming.py            # Streaming response handling
│   ├── commands.py                 # Slash command dispatch
│   ├── tool_execution.py           # Tool parsing + execution
│   ├── config.py                   # Configuration management
│   ├── llamacpp.py                 # llama.cpp server management
│   ├── model_manager.py            # Model manager UI
│   ├── download_ui.py              # Model downloader UI
│   ├── color_utils.py              # Gradient text, Rich console
│   ├── ui_rendering.py             # Title box, panels, preview rendering
│   ├── hw_utils.py                 # Hardware detection (GPU, VRAM, RAM)
│   ├── info_utils.py               # Display helpers (model names, session list)
│   └── type_defs.py                # TypedDicts, Protocol classes
├── commands/
│   ├── skills/                     # Agent-invocable skills (SEARCH, HELP, EXAMPLE)
│   └── tools/                      # Agent-invocable tools (BUILD, FETCH, MEMORIZE, ...)
└── git_hooks/
    └── pre-commit                  # Pre-commit hook for AI-powered code review
```

---

> Last updated: 2026-02-22
