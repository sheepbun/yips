## 2026-02-23 20:57 MST — Exchange 57

Summary: Implemented llama.cpp server lifecycle management with boot/request readiness checks, auto-start diagnostics, and config schema expansion; included and committed prior in-progress workspace changes.
Changed:

- Added `src/llama-server.ts` with managed lifecycle helpers:
  - health probe (`/health`) checks
  - binary resolution (`LLAMA_SERVER_PATH`, config path, `which llama-server`, fallback path)
  - model resolution (absolute path, models-dir relative, recursive `.gguf` partial match)
  - server start with configurable host/port/context/gpu-layers
  - managed stop/cleanup for processes started by Yips
  - typed failure reasons and `formatLlamaStartupFailure(...)` for actionable UX
- Expanded runtime config schema:
  - `src/types.ts` adds `llamaServerPath`, `llamaModelsDir`, `llamaHost`, `llamaPort`, `llamaContextSize`, `llamaGpuLayers`, `llamaAutoStart`.
  - `src/config.ts` now defaults/normalizes those fields, keeps backward compatibility, and supports env overrides (`YIPS_LLAMA_*`, `YIPS_LLAMA_AUTO_START`).
- Integrated lifecycle checks in `src/tui.ts`:
  - boot preflight readiness check for `llamacpp`
  - per-request readiness check before chat/stream path
  - startup failure output now includes actionable diagnostics and exact checks
  - unmount cleanup now calls managed llama-server stop
- Added new lifecycle tests in `tests/llama-server.test.ts` for:
  - healthy endpoint readiness
  - auto-start-disabled failure behavior
  - binary-not-found classification
  - model-not-found classification
  - process-exited classification
  - diagnostic formatter content
- Updated `tests/config.test.ts` for expanded config fields and env override coverage.
- Included existing workspace changes requested for commit (`docs/stack.md`, `src/colors.ts`, `src/input-engine.ts`, `tests/input-engine.test.ts`, `src/hardware.ts`, `.yips_config.json`).
  Validation:
- `npm run typecheck` — clean
- `npm test` — clean (21 files, 199 tests)
- `npm run lint` — clean
  Next:
- Add `/backend` implementation and optional Claude fallback path so users can recover from llama.cpp failures without leaving chat mode.
- Add focused TUI integration tests for startup preflight message rendering and managed shutdown behavior.
