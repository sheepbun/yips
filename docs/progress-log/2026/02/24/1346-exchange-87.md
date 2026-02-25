## 2026-02-24 13:46 MST — Exchange 87

Summary: Removed `/keys`, `/build`, and `/todos` from the TypeScript command surface and docs.
Changed:

- Updated `src/commands.ts`:
  - removed `/keys` registration and deleted in-file key diagnostics text constant.
- Updated `src/command-catalog.ts`:
  - removed restored command defaults for `build` and `todos`.
- Updated tests:
  - `tests/commands.test.ts` removed `/keys` registry and output assertions.
  - `tests/command-catalog.test.ts` replaced build override fixture with fetch override fixture.
  - `tests/prompt-composer.test.ts` replaced `/build` autocomplete fixtures with active commands (`/download`, `/dl`).
  - `tests/tui-resize-render.test.ts` replaced `/build` autocomplete fixture with `/download`.
- Updated docs:
  - `docs/guides/getting-started.md` removed `/keys` troubleshooting instruction.
  - `docs/guides/slash-commands.md` removed `/build` and `/todos` from reference and complete list.
  - `docs/changelog.md` removed the unreleased `/keys` added entry.
    Validation:
- `npm test -- tests/commands.test.ts tests/command-catalog.test.ts tests/prompt-composer.test.ts tests/tui-resize-render.test.ts` — clean (62 passing)
- `npm run typecheck` — clean
  Next:
- Optional: run full-suite `npm test` and `npm run lint` before committing.
