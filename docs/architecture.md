# Architecture

## High-Level Components

```text
┌──────────────────────────────────────────────────────────┐
│                        TUI Layer                         │
│  Input handling, layout, streaming display, status bar   │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│                    Agent Turn Engine                     │
│  Context assembly, envelope parsing, action execution,   │
│  result chaining, warning/pivot handling                 │
└──────┬──────────────────┬──────────────────┬─────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Tool Runner │  │  Skill Runner   │  │ Subagent Runner │
└──────┬──────┘  └───────┬─────────┘  └────────┬─────────┘
       │                 │                      │
       ▼                 ▼                      ▼
┌──────────────────────────────────────────────────────────┐
│                     LLM Backend                          │
│  llama.cpp (primary) │ Claude CLI (fallback)             │
└──────────────────────────────────────────────────────────┘
```

## Codebase Layout

The TypeScript rewrite uses a domain-first source tree:

- `src/app` entrypoints and startup
- `src/agent` orchestration, protocol, tools, skills, and core turn engine
- `src/config` config and hooks
- `src/gateway` adapters and headless runtime
- `src/llm` backend client/server lifecycle
- `src/models` hardware + model discovery/download
- `src/ui` TUI rendering and input systems

See [Project Tree](./project-tree.md) for file-level mapping.

## Context Assembly

Each llama request is composed from:

1. Protocol system prompt (`TOOL_PROTOCOL_SYSTEM_PROMPT`) with tool-envelope instructions.
2. Optional `CODE.md` system context message.
3. Existing chat history.

This composition path is shared across TUI and gateway headless runtime.

## Tool-Call Protocol

Yips uses structured fenced JSON envelopes.

### Preferred format: `yips-agent`

```yips-agent
{
  "assistant_text": "optional",
  "actions": [
    {
      "type": "tool",
      "id": "t1",
      "name": "read_file",
      "arguments": { "path": "README.md" }
    }
  ]
}
```

### Compatibility format: `yips-tools`

Legacy compatibility is still accepted via `tool_calls`, `skill_calls`, and `subagent_calls`.

### Parse Contract

- Exactly one envelope block per assistant message.
- JSON body required; object root required.
- Duplicate action IDs are deduplicated with warnings.
- Unsupported/malformed calls are filtered.

See [Tool Calls Guide](./guides/tool-calls.md) for full schema and examples.

## Turn Engine and Chaining

`runAgentTurn(...)` executes bounded multi-round orchestration:

1. Request assistant response.
2. Parse envelope and assistant text.
3. Emit assistant text to UI/runtime.
4. Execute actions through unified action runner.
5. Inject action results into history.
6. Repeat while actions are present and round budget remains.

If consecutive rounds fail (`error`/`denied`/`timeout`), the engine injects automatic pivot guidance.

## Safety Model

Tool execution uses `ActionRiskAssessment` with:

- `none`: run immediately
- `confirm`: require user confirmation (TUI)
- `deny`: deny immediately

Risk includes destructive command patterns and outside-working-zone paths/cwd.

Gateway headless mode auto-denies risky calls rather than interactive confirmation, except for the explicit two-phase file-apply action (`apply_file_change`), which serves as non-interactive approval when a valid preview token is provided.

## File Mutation Staging

File mutations are handled as a two-step flow:

1. Stage diff with `preview_write_file` or `preview_edit_file`.
2. Apply staged change with `apply_file_change(token)`.

Staged changes are session-scoped, in-memory, short-lived tokens with stale-file detection before apply.

## Request Flow

```text
User Input
    │
    ├─ Slash Command? (/model, /stream, /verbose, /exit, ...)
    │   └─> Handle locally (no LLM call) → return
    │
    └─ Regular Message
        │
        ├─> Compose system context (protocol prompt + optional CODE.md)
        ├─> Send to LLM backend
        │
        ├─ Streaming enabled?
        │   ├─ YES → stream tokens to UI
        │   └─ NO  → wait for complete response
        │
        ├─> Parse one action envelope (`yips-agent` preferred)
        ├─> Execute actions (tool/skill/subagent) with safety checks
        ├─> Append results to history for follow-up rounds
        └─> Display final assistant output
```

## LLM Backend

### llama.cpp (Primary)

- OpenAI-compatible `/v1/chat/completions` API
- streaming and non-streaming support
- managed startup/readiness behavior
- model selection and hardware-aware workflows

### Claude CLI (Fallback)

- subprocess integration (`--print`, `--resume`)
- line-buffered streaming behavior

## Gateway Architecture

```text
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
│              Headless Agent Turn Engine Path                │
│        (same protocol and action model as the TUI)          │
└──────────────────────────────────────────────────────────────┘
```

See [Gateway Guide](./guides/gateway.md) for runtime-specific details.

---

> Last updated: 2026-02-25
