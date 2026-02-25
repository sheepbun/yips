## 2026-02-23 15:49 MST — Exchange 35

Summary: Anchored title-box greeting and cwd gradients to each string span so colors begin/end on the first/last visible character.
Changed:

- Updated `src/title-box.ts`:
  - added `styleCenteredTextWithGradientSpan(...)` to center text while applying gradient only across the actual string, leaving side padding uncolored
  - switched full/single layout welcome rows and cwd rows to use the new helper
- Updated `tests/title-box.test.ts`:
  - added regression coverage validating ANSI start/end colors for both "Welcome back {user}!" and `{cwd}` in single layout
    Validation:
- `npm test` — clean (123 passing)
- `npm run typecheck` — clean
  Next:
- Run `npm run dev` for a quick visual check that centered greeting/cwd gradients now start and end exactly on the text bounds.
