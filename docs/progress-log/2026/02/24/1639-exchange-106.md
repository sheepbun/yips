## 2026-02-24 16:39 MST — Exchange 106

Summary: Reduced awkward wide-terminal spacing in Model Manager columns by capping dynamic table width growth.
Changed:

- Updated `src/model-manager-ui.ts` column sizing logic:
  - replaced unbounded `file` column growth with a capped dynamic-width budget (`72` chars for `name + file`).
  - extra terminal width now appears as trailing row space after the table instead of stretching internal columns.
  - added overflow guard so narrow terminals still shrink safely without breaking rendering.
    Validation:
- `npm test -- tests/model-manager-ui.test.ts` — clean (3 passing)
- `npm run typecheck` — clean
- `npm run lint -- src/model-manager-ui.ts` — clean
  Next:
- Optional visual pass in `npm run dev` to confirm spacing feels right at your typical terminal widths (especially very wide windows).
