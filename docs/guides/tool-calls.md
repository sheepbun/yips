# Tool Calls

This guide explains how Yips triggers tool use with structured action envelopes, how safety gating works, and how to diagnose cases where calls are not executed.

## Purpose

Yips can execute tools, skills, and delegated subagent tasks during a conversation turn. Instead of ad-hoc tag parsing, the runtime expects a structured fenced JSON envelope from the model.

The preferred envelope is `yips-agent`.

## End-to-End Flow

Request and execution sequence:

1. Yips builds chat request messages.
2. A protocol system prompt (`TOOL_PROTOCOL_SYSTEM_PROMPT`) is prepended as a `system` message.
3. `CODE.md` context is optionally prepended as another `system` message.
4. Conversation history is appended.
5. Model responds.
6. Parser (`parseAgentEnvelope`) extracts exactly one envelope and validates it.
7. Conductor turn engine (`runAgentTurn`) dispatches actions via the action runner.
8. Safety policy evaluates each tool action (`none | confirm | deny`).
9. Results are injected back into history as system entries for chaining.
10. If no valid actions are present, the turn completes as normal assistant text.

## Message Composition Rules

`composeChatRequestMessages(history, codeContextMessage)` always includes:

- Protocol guidance system message.
- Optional CODE.md system message.
- Prior chat history.

This behavior is shared by TUI and gateway headless runtime.

## Envelope Formats

### Preferred: `yips-agent`

Use one fenced block per assistant message:

```yips-agent
{
  "assistant_text": "Optional plain-language response",
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

Action types:

- `tool`
- `skill`
- `subagent`

### Legacy Compatibility: `yips-tools`

Still accepted during compatibility period:

```yips-tools
{
  "tool_calls": [
    { "id": "t1", "name": "list_dir", "arguments": { "path": "." } }
  ],
  "skill_calls": [
    { "id": "s1", "name": "search", "arguments": { "query": "yips" } }
  ],
  "subagent_calls": [
    { "id": "a1", "task": "summarize docs", "max_rounds": 2 }
  ]
}
```

`yips-tools` is compatibility-only. `yips-agent` is the canonical format.

## Allowed Names and Validation

### Allowed tools

- `read_file`
- `preview_write_file`
- `preview_edit_file`
- `apply_file_change`
- `write_file`
- `edit_file`
- `list_dir`
- `grep`
- `run_command`

### File mutation flow

Canonical two-phase mutation flow:

1. Stage the change with `preview_write_file` or `preview_edit_file`.
2. Read `metadata.token` and `metadata.diffPreview`.
3. Apply with `apply_file_change` and `{ "token": "<token>" }`.

Compatibility behavior:

- `write_file` and `edit_file` are accepted for backward compatibility.
- They are translated to preview-only staging and return `metadata.legacyTranslated: true`.
- They do not mutate files directly.

### Allowed skills

- `search`
- `fetch`
- `build`
- `todos`
- `virtual_terminal`

### Parse constraints

- Exactly one fenced envelope block per assistant message.
- Envelope body must be valid JSON.
- JSON root must be an object.
- Action IDs must be unique within one message.
- Unsupported names or malformed entries are ignored/filtered.

## Execution and Round Chaining

`runAgentTurn` executes in rounds (default max: 6):

- Parse envelope and assistant text.
- Emit assistant text.
- Execute parsed actions.
- Append `Action results:` and typed result summaries into history.
- Continue rounds when actions exist; stop when none exist.

If consecutive rounds are all failures (`error`, `denied`, `timeout`), the engine injects automatic pivot guidance.

## Safety Policy

Tool calls are evaluated with `ActionRiskAssessment`:

- `riskLevel: "none"` -> execute normally.
- `riskLevel: "confirm"` -> ask user confirmation in TUI.
- `riskLevel: "deny"` -> denied immediately.

Risk signals include:

- destructive command patterns
- outside-working-zone path/cwd

Gateway behavior:

- confirm-level actions are denied by default.
- `apply_file_change` is the explicit non-interactive approval action in gateway mode and is allowed when token/path validation succeeds.

## Common Failure Modes

### No envelope

Symptom: assistant answers normally, no tool execution.
Cause: model did not emit `yips-agent`/`yips-tools` fenced block.

### Malformed JSON

Symptom: warning with protocol parse error; no actions executed.
Cause: invalid JSON body.

### Multiple envelopes

Symptom: parse error (`expected exactly one`).
Cause: assistant emitted more than one fenced envelope block.

### Unknown action/tool/skill names

Symptom: calls silently absent from executed actions.
Cause: name not in allow-list.

### Duplicate IDs

Symptom: warning about duplicate ID; later duplicate ignored.
Cause: repeated `id` within same envelope.

### Policy denial

Symptom: tool result status `denied`.
Cause: `confirm` rejected by user or `deny` risk level reached.

## Troubleshooting Checklist

1. Run with `/verbose` enabled and reproduce once.
2. Confirm model output includes exactly one fenced envelope.
3. Confirm block tag is `yips-agent` (preferred) or `yips-tools` (compat).
4. Validate JSON and required keys (`type`, `id`, `name`/`task`, `arguments`).
5. Confirm action names are in the allow-lists above.
6. Check whether call was denied by risk policy.
7. If using gateway, remember confirm-level actions are auto-denied except explicit `apply_file_change` with a valid token.
8. If parser errors persist, simplify to a one-action minimal envelope and retry.

## Minimal Examples

Valid minimal tool action:

```yips-agent
{
  "actions": [
    {
      "type": "tool",
      "id": "t1",
      "name": "list_dir",
      "arguments": { "path": "." }
    }
  ]
}
```

Invalid (multiple blocks):

````text
```yips-agent
{"actions":[{"type":"tool","id":"t1","name":"list_dir","arguments":{"path":"."}}]}
````

```yips-agent
{"actions":[{"type":"tool","id":"t2","name":"read_file","arguments":{"path":"README.md"}}]}
```

````

Invalid (unknown tool):

```yips-agent
{
  "actions": [
    {
      "type": "tool",
      "id": "x1",
      "name": "delete_everything",
      "arguments": {}
    }
  ]
}
```

## Source Map

Primary implementation files:

- `src/agent/protocol/system-prompt.ts`
- `src/agent/protocol/agent-envelope.ts`
- `src/agent/core/turn-engine.ts`
- `src/agent/core/action-runner.ts`
- `src/agent/tools/action-risk-policy.ts`
- `src/ui/tui/runtime-core.ts`
- `src/gateway/headless-conductor.ts`

Related tests:

- `tests/agent/protocol/agent-envelope.test.ts`
- `tests/agent/core/turn-engine.test.ts`
- `tests/agent/tools/action-risk-policy.test.ts`
- `tests/gateway/headless-conductor.test.ts`
- `tests/ui/tui/tui-code-context.test.ts`

---

> Last updated: 2026-02-25
````
