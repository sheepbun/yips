## 2026-02-25 14:47 MST — Exchange 182

Summary: Implemented GPU capability preflight + warn-and-continue fallback in llama startup, added regression tests, and rebuilt local llama.cpp with CUDA backend verification.
Changed:

- Updated `src/llm/llama-server.ts`:
  - Added device probe path (`--list-devices`) and parser (`parseLlamaDeviceCount`).
  - Added startup warning propagation on GPU mismatch (`warnings` in ensure/start result).
  - Added launch normalization to force `-ngl 0` when `llamaGpuLayers > 0` but no devices are available.
- Updated `src/ui/tui/runtime-core.ts`:
  - Added one-time startup warning surfacing in the TUI session (`formatWarningMessage` output once per unique warning).
  - Wired warning rendering into both on-demand readiness checks and preload checks.
- Updated `src/gateway/headless-conductor.ts`:
  - Captures non-fatal startup warnings and returns them via response metadata once per runtime (`metadata.startupWarnings`).
- Added tests:
  - `tests/llm/llama-server.test.ts`: device count parsing + startup behavior for no-device fallback (`-ngl 0`) and device-present behavior.
  - `tests/ui/tui/tui-action-box-render.test.ts`: explicit streaming-preview-to-final-envelope regression case.
  - `tests/gateway/headless-conductor.test.ts`: startup warning metadata emission once.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/llm/llama-server.test.ts tests/ui/tui/tui-action-box-render.test.ts tests/gateway/headless-conductor.test.ts` — clean
- Environment validation:
  - `/home/katherine/llama.cpp/build/bin/llama-server --list-devices` now reports CUDA0 RTX 3080.
  - Foreground model load shows CUDA offload/KV/compute buffers on GPU.
  - Streaming probe reports ~`106 tok/s` in server timings with ~6.3 GiB GPU memory in use.

Next:

- If Yips still starts an older CPU-only server, verify `llamaServerPath`/`LLAMA_SERVER_PATH` points to `/home/katherine/llama.cpp/build/bin/llama-server`.
