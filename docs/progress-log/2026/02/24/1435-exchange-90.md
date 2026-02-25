## 2026-02-24 14:35 MST — Exchange 90

Summary: Adjusted title token usage format so the used side also shows `k` for values >= 1000.
Changed:

- Updated `src/token-counter.ts` formatting:
  - used side now renders with `k` suffix when >= 1000 (`15.7k/32.2k tks`).
  - values < 1000 remain plain integers (`0/32k tks`).
- Updated `tests/token-counter.test.ts` to assert `15.7k/32.2k tks` output.
  Validation:
- `npm test -- tests/token-counter.test.ts` — clean (8 passing)
- `npm run typecheck` — clean
  Next:
- Optional visual confirmation in `npm run dev` that title usage formatting matches desired display.
