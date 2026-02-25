## 2026-02-25 04:22 MST — Exchange 145

Summary: Fixed title-box version regression after cwd-preserving launcher change by making git version lookups target the Yips repo root explicitly.
Changed:

- Updated `src/version.ts`:
  - added repo-root resolution (`resolve(__dirname, "..")`).
  - `getGitInfo()` now executes git with `-C <repo_root>` for both commit timestamp and short SHA queries.
  - this decouples version generation from launch cwd.
- Updated `tests/version.test.ts`:
  - adjusted git command stub routing to handle `-C` argument prefix.
  - added regression test asserting `getGitInfo()` includes `-C <repo_root>` for both git invocations.
  - added `beforeEach` mock reset to avoid cross-test call accumulation.

Validation:

- `npm test -- tests/version.test.ts` — clean (9 passing)
- `npm test -- tests/tui-resize-render.test.ts` — clean (26 passing)

Next:

- Optional: run `npm test` for a full-suite confirmation after the launcher/cwd + version behavior changes.
