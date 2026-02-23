# Architecture

## High-Level Components

```
┌──────────────────────────────────────────────────────────┐
│                        TUI Layer                         │
│  Input handling, layout, streaming display, status bar   │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│                       Conductor                          │
│  Receives user input, assembles context, plans actions,  │
│  delegates to Subagents, manages conversation state      │
└──────┬──────────────────┬──────────────────┬─────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Subagent   │  │    Subagent     │  │    Subagent      │
│  (file ops) │  │  (search/fetch) │  │  (build/test)    │
└──────┬──────┘  └───────┬─────────┘  └────────┬─────────┘
       │                 │                      │
       ▼                 ▼                      ▼
┌──────────────────────────────────────────────────────────┐
│                     LLM Backend                          │
│  llama.cpp (primary) │ Claude CLI (fallback)             │
└──────────────────────────────────────────────────────────┘
```

## Conductor / Subagent Model _(planned)_

The current yips-cli uses a single-agent loop. The TypeScript rewrite will introduce a Conductor/Subagent architecture:

- **Conductor**: The top-level agent. It receives every user message, decides whether to handle it directly or delegate, and owns the conversation state. The Conductor assembles its context from CODE.md, project files, memory, and system information.

- **Subagents**: Focused workers spawned by the Conductor for bounded tasks (e.g., "read these 5 files and summarize," "run the test suite and report failures"). Each Subagent has a scoped context, a limited tool set, and reports results back to the Conductor. Subagents do not persist across turns.

- **Delegation**: The Conductor decides to delegate when a task is self-contained and benefits from isolation (separate context window, parallel execution). The delegation message includes the task description, allowed tools, and any relevant context excerpts.

- **Lifecycle**: Subagent spawned → receives task + scoped context → executes tools → returns result → terminated. The Conductor integrates the result into its own conversation.

## Context System

The agent's system prompt is assembled at session start from multiple sources:

```
System Prompt
├── Soul document (AGENT.md) — personality, principles, tool protocol
├── Identity (IDENTITY.md) — evolving self-understanding
├── Human info (author/HUMAN.md) — information about the user
├── System information — version, backend, model, hardware specs, context limits
├── Focus area (.yips/FOCUS.md) — current project focus
├── User preferences (.yips/preferences.json)
├── Recent git commits — last 5 commits from the working directory
├── Recent memories — last 5 memory files from memories/
├── Available commands — dynamically discovered from tools/ and skills/ dirs
└── Thought signature — current task plan, if set
```

In the TypeScript rewrite, this will also include:

- **CODE.md** from the current project directory (see [CODE.md Guide](./guides/code-md.md))
- **Subagent context** scoped per-delegation _(planned)_

## Tool Protocol

Tools are how the agent takes action. In yips-cli, the agent embeds tagged requests in its response text; the tool execution layer parses and executes them autonomously.

### Action Tags

```
{ACTION:read_file:/path/to/file}
{ACTION:write_file:/path/to/file:content}
{ACTION:edit_file:path:::old_string:::new_string}
{ACTION:run_command:command --with --args}
{ACTION:ls:/path/to/dir}
{ACTION:grep:pattern:/path}
{ACTION:git:status}
{ACTION:sed:expression:/path}
{ACTION:create_plan:name:content}
```

### Skill Invocation

```
{INVOKE_SKILL:SEARCH:current TypeScript TUI frameworks}
{INVOKE_SKILL:FETCH:https://example.com}
{INVOKE_SKILL:BUILD}
{INVOKE_SKILL:MEMORIZE:save session_notes}
{INVOKE_SKILL:RENAME:New Session Title}
{INVOKE_SKILL:VT:npm test}
```

### Thought Signatures

```
{THOUGHT:Refactoring the context loader to support CODE.md}
```

Sets a persistent high-level goal visible in the agent's context until changed.

### Execution Model

- **Autonomous by default**: File reads, writes, commands, and skill invocations execute without confirmation.
- **Confirmation required**: Destructive commands matching safety patterns (`rm -rf`, `mkfs`, `dd`, `reboot`, system package removal) prompt the user before execution.
- **Working zone enforcement**: File operations outside the designated working directory prompt for confirmation.
- **Deduplication**: Identical consecutive tool requests are deduplicated (LLMs sometimes repeat tags).
- **Error recovery**: On consecutive errors, the system notifies the agent, which pivots to an alternative approach or asks the user for help.

### TypeScript Rewrite Changes _(planned)_

The tag-based protocol (`{ACTION:...}`, `{INVOKE_SKILL:...}`) will be replaced with a structured protocol — likely JSON-based tool calls or a function-calling convention — to improve parseability, type safety, and compatibility with model APIs that support native tool use.

## Request Flow

```
User Input
    │
    ├─ Slash Command? (/model, /stream, /verbose, /exit, ...)
    │   └─> Handle command directly (no LLM call) → return
    │
    └─ Regular Message
        │
        ├─> Conductor assembles context (CODE.md, memory, system info)
        ├─> Send to LLM backend
        │
        ├─ Streaming enabled?
        │   ├─ YES → Stream tokens, display with gradient, buffer tool calls
        │   └─ NO  → Show spinner, wait for complete response
        │
        ├─> Parse response for tool requests
        │   ├─ Action tags → execute autonomously (or confirm if destructive)
        │   ├─ Skill invocations → run skill script, capture output
        │   ├─ Identity updates → append to IDENTITY.md
        │   └─ Thought signatures → update session state
        │
        ├─> Feed tool results back to LLM (automatic chaining)
        │
        └─> Display final response to user
```

## LLM Backend

### llama.cpp (Primary)

Yips manages llama.cpp as a subprocess:

- **Model management**: Download, list, and switch models via `/model` and `/download`
- **Hardware-aware**: Detects GPU/VRAM and selects appropriate model quantization
- **Server lifecycle**: Starts/stops the llama.cpp HTTP server as needed
- **API**: OpenAI-compatible `/v1/chat/completions` endpoint with streaming support
- **Fallback**: On error, falls back to non-streaming mode, then to Claude CLI if available

### Claude CLI (Fallback)

- Subprocess-based integration (`--print`, `--resume`)
- Streaming via line-buffered stdout reading
- Supports model selection (haiku, sonnet, opus)

## Gateway Architecture _(planned)_

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│    WhatsApp      │   │    Telegram      │   │    Discord       │
│    Adapter       │   │    Adapter       │   │    Adapter       │
└────────┬────────┘   └────────┬─────────┘   └────────┬────────┘
         │                     │                       │
         ▼                     ▼                       ▼
┌──────────────────────────────────────────────────────────────┐
│                       Gateway Core                           │
│  Message routing, session management, rate limiting,         │
│  authentication, platform-specific formatting                │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Conductor + Subagents                      │
│              (same system as TUI, headless mode)             │
└──────────────────────────────────────────────────────────────┘
```

The gateway will reuse the same Conductor/Subagent system that powers the TUI, running in headless mode. Platform adapters will handle protocol-specific concerns (webhooks, authentication, message format conversion) while the gateway core manages routing, sessions, and security.

See [Gateway Guide](./guides/gateway.md) for setup and configuration details.

---

> Last updated: 2026-02-22
