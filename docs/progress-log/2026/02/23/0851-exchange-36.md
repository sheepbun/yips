## 2026-02-23 08:51 MST — Exchange 36

Summary: Changed the full-layout title-box "Recent activity" label color to white.
Changed:

- Updated `src/title-box.ts`:
  - added `white` style support in `styleLeftText(...)` using ANSI `rgb(255,255,255)`
  - switched full-layout right-column "Recent activity" row from blue to white
- Updated `tests/title-box.test.ts`:
  - added regression test asserting the "Recent activity" text starts with white ANSI foreground color
    Validation:
- `npm test -- tests/title-box.test.ts` — clean (14 passing)
  Next:
- Run `npm run dev` and visually confirm the full-layout "Recent activity" row appears white in your terminal theme.
