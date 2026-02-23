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
- **How it works**: Yips starts a `llama-server` subprocess, sends requests to `http://localhost:{port}/v1/chat/completions`, and manages the process lifecycle.
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

### TUI Framework (terminal-kit)

- **Choice**: terminal-kit.
- **Why**: Fine-grained terminal control with truecolor support (`^#rrggbb` markup), built-in `inputField()` with history and autocompletion, alternate screen buffer support, and direct cursor addressing for the three-zone layout (output area, status bar, input line).
- **Alternatives considered**: Ink (React dependency, limited low-level control), blessed (maintenance unclear, callback-heavy API).
- **Comparison to yips-cli**: Replaces Rich (Live, Panel, Tree) and prompt_toolkit with a single library providing equivalent capabilities.

### Distribution

How users install and update Yips.

| Candidate | Pros | Cons |
|-----------|------|------|
| **npm** (`npx yips`) | Standard Node.js distribution, easy publishing, automatic dependency resolution | Requires Node.js pre-installed, `node_modules` overhead |
| **Standalone binary** (pkg, bun build, nexe) | No runtime dependency for user, single file | Large binary size, platform-specific builds, harder to debug |
| **Homebrew** | Familiar to macOS/Linux developers, formula-based updates | macOS/Linux only, formula maintenance overhead |

**Requirements**: Works on Linux and macOS. Ideally single-command install. Should handle llama.cpp setup (bundled or first-run download).

<!-- TODO: Decide after Milestone 1. Start with npm for development, evaluate binary packaging for release. -->

## Comparison to yips-cli

For reference, the Python CLI's stack:

| Concern | yips-cli | yips (planned) |
|---------|----------|----------------|
| Language | Python 3 | TypeScript |
| Runtime | CPython | Node.js |
| TUI | Rich (Live, Panel, Tree) | terminal-kit |
| LLM backend | llama.cpp + LM Studio + Claude CLI | llama.cpp + Claude CLI |
| Config | `.yips_config.json` (JSON) | `.yips_config.json` (JSON) |
| Skills | Python scripts (subprocess) | TypeScript modules |
| Package manager | pip + requirements.txt | npm |
| Testing | — (no test suite) | Vitest |

---

> Last updated: 2026-02-22
