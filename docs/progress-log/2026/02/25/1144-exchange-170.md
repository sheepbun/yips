## 2026-02-25 11:44 MST — Exchange 170

Summary: Added comprehensive documentation for the tool-call envelope system and synchronized architecture docs to current implementation.

Changed:

- Added new guide `docs/guides/tool-calls.md` covering:
  - protocol prompt injection and request composition flow
  - `yips-agent` preferred schema and `yips-tools` compatibility schema
  - parse/validation constraints and action allow-lists
  - turn-engine chaining behavior and safety policy (`none|confirm|deny`)
  - failure modes, troubleshooting checklist, and valid/invalid examples
  - source/test map for implementation references
- Updated docs navigation and guide cross-links:
  - `docs/README.md`: added Tool Calls guide to the map
  - `docs/guides/getting-started.md`: added short “How Tool Calls Are Triggered” section linking to the new guide
  - `docs/guides/slash-commands.md`: `/verbose` now references Tool Calls troubleshooting
- Synchronized architecture docs with current runtime behavior:
  - `docs/architecture.md` now documents protocol system prompt injection, `yips-agent` envelope parsing, action runner/turn engine flow, and risk policy semantics
  - removed legacy tag-based tool protocol description as current behavior
- Updated changelog:
  - `docs/changelog.md` includes concise doc sync note under Unreleased

Validation:

- Link integrity pass across changed markdown files (relative links verified).
- Snippet consistency pass against implementation files (`system-prompt.ts`, `agent-envelope.ts`, `turn-engine.ts`, `action-risk-policy.ts`).
- Optional formatting check:
  - `npx prettier --check docs/guides/tool-calls.md docs/README.md docs/guides/getting-started.md docs/guides/slash-commands.md docs/architecture.md docs/changelog.md docs/progress-log/2026/02/25/1144-exchange-170.md docs/progress-log.md` — clean.

Next:

- Optionally add a short “tool call quick reference” table in the TUI help output or slash command docs if users need faster in-terminal recall.
