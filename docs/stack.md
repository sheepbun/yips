# Tech Stack

## Decided

### TypeScript (strict mode)

- **Why**: Type safety for the tool protocol and agent system, strong editor tooling, large ecosystem for TUI libraries and platform SDKs (Discord, Telegram).
- **Strict mode**: `strict: true` in tsconfig. No implicit `any`, no unchecked index access.
- **Comparison to yips-cli**: Python's type hints are advisory and not enforced at runtime. TypeScript's compiler catches type errors before execution.

### Node.js

- **Why**: Broadest ecosystem support for TypeScript. Native `child_process` for managing llama.cpp. Well-supported by TUI frameworks (Ink, blessed).
- **Note**: Bun may be revisited for performance (faster startup, built-in bundler), but Node.js is the safer starting point for ecosystem compatibility.

### llama.cpp (primary LLM backend)

- **Why**: Direct control over model lifecycle — download, serve, stop, switch. CUDA and Metal support for GPU inference. OpenAI-compatible HTTP API for clean integration.
- **How it works**: Yips sends OpenAI-compatible chat requests to `http://localhost:{port}/v1/chat/completions` (streaming and non-streaming), with in-memory conversation history assembled in the TUI session.
- **Comparison to yips-cli**: Same approach. The Python version already uses llama.cpp as its primary backend.

### Config Format (JSON)

- **Choice**: JSON (`.yips_config.json`) for Milestone 0.
- **Why**: Zero parser dependencies and direct support via `JSON.parse`.
- **Tradeoff**: No comments; TOML may be revisited after core milestones.

### Package Manager (npm)

- **Choice**: npm.
- **Why**: Ubiquitous default in Node.js environments and easiest onboarding.

### Formatter (Prettier)

- **Choice**: Prettier.
- **Why**: Stable ecosystem integration and consistent Markdown/TypeScript formatting.

### Test Framework (Vitest)

- **Choice**: Vitest.
- **Why**: Fast TypeScript-first test runner with straightforward setup.

### TUI Framework (Ink)

- **Choice**: Ink.
- **Why**: React-style component model with portable input handling, predictable render/update lifecycle, and easier long-term maintainability than low-level terminal drawing loops.
- **Alternatives considered**: terminal-kit (more manual terminal control, heavier direct cursor management), blessed (maintenance unclear, callback-heavy API).
- **Comparison to yips-cli**: Replaces Rich (Live, Panel, Tree) and prompt_toolkit with a React-driven CLI rendering model.

### Distribution

How users install and update Yips.

**Primary channel (current decision)**:

- **npm package** for distribution and versioning.
- **`install.sh`** for local-first setup (llama.cpp build/wiring + launcher flow).
- **Guided update UX** via `/update` (checks npm latest and prints explicit upgrade commands).
- **`yips.dev`** is the docs/download hub, not the authoritative package registry.

**Deferred channels**:

- Standalone binary releases (deferred for a later milestone due to cross-platform build complexity).
- Homebrew formula/tap (deferred until release cadence stabilizes).

**Platform support policy**:

- Linux: supported
- macOS: supported
- Windows: WSL2 supported (native Windows packaging deferred)

## Comparison to yips-cli

For reference, the Python CLI's stack:

| Concern | yips-cli | yips (planned) |
|---------|----------|----------------|
| Language | Python 3 | TypeScript |
| Runtime | CPython | Node.js |
| TUI | Rich (Live, Panel, Tree) | Ink |
| LLM backend | llama.cpp + Claude CLI | llama.cpp + Claude CLI |
| Config | `.yips_config.json` (JSON) | `.yips_config.json` (JSON) |
| Skills | Python scripts (subprocess) | TypeScript modules |
| Package manager | pip + requirements.txt | npm |
| Testing | — (no test suite) | Vitest |

---

> Last updated: 2026-02-25
