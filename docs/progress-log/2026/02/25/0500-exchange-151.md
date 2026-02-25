## 2026-02-25 05:00 MST — Exchange 151

Summary: Completed a focused TUI split follow-up so `src/ui/tui/app.ts` is now a thin facade and runtime implementation lives in `src/ui/tui/runtime-core.ts`.
Changed:

- Moved large Ink runtime implementation:
  - `src/ui/tui/app.ts` → `src/ui/tui/runtime-core.ts`
- Added new thin facade `src/ui/tui/app.ts`:
  - re-exports `createInkApp` and `InkModule` from `runtime-core`
- Updated `docs/project-tree.md` to include `runtime-core.ts`.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (37 files, 340 tests)
- `npm run build` — clean

Next:

- Optional: continue decomposing `runtime-core.ts` by moving mode handlers (`chat/downloader/model-manager/vt`) into dedicated files now that facade boundaries are in place.
