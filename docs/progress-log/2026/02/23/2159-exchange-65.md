## 2026-02-23 21:59 MST — Exchange 65

Summary: Implemented Linux-first llama.cpp port-conflict handling with configurable policy, richer startup diagnostics, and bind-error classification to fix ambiguous startup failures.
Changed:

- Extended config/types for startup conflict policy:
  - `src/types.ts`: added `LlamaPortConflictPolicy` and `AppConfig.llamaPortConflictPolicy`.
  - `src/config.ts`: added normalization/default/env override support for `llamaPortConflictPolicy` (`YIPS_LLAMA_PORT_CONFLICT_POLICY`), defaulting to `kill-user`.
- Refactored `src/llama-server.ts` lifecycle behavior:
  - added Linux `/proc` listener ownership inspection to identify PID/UID/cmd for occupied ports.
  - added policy-driven pre-start conflict handling:
    - `fail`: return `port-unavailable` with owner diagnostics.
    - `kill-llama`: only terminate conflicting owner when command matches llama-server.
    - `kill-user`: terminate conflicting owner only when owned by current user.
  - added SIGTERM→SIGKILL termination flow with re-check to ensure port is actually freed.
  - added structured failure metadata (`host`, `port`, `conflictPid`, `conflictCommand`).
  - switched spawn stderr handling to a captured ring buffer and added bind-error pattern classification so early-exit bind failures are reported as `port-unavailable`.
  - improved startup failure formatting with endpoint/conflict context.
- Expanded tests:
  - `tests/config.test.ts`: env override coverage for `YIPS_LLAMA_PORT_CONFLICT_POLICY`.
  - `tests/llama-server.test.ts`: added policy and bind-classification coverage with deterministic mocked runtime dependencies; added cleanup via `stopLlamaServer()` to avoid cross-test state leakage.
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/llama-server.test.ts tests/config.test.ts` — clean
- `npm test` — clean (21 files, 203 tests)
- `npm run build` — clean
  Next:
- Optionally surface a short UI warning line when Yips auto-terminates a conflicting process, so users can see that recovery action happened without enabling verbose logs.
