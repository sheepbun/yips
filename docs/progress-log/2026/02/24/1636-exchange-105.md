## 2026-02-24 16:36 MST — Exchange 105

Summary: Reworked Model Manager list columns to reduce squish, reordered to `backend | provider | name | file | size`, and added a header row.
Changed:

- Updated `src/model-manager-ui.ts` table rendering:
  - reordered model row columns to `backend | provider | name | file | size`.
  - switched `name` column to `friendlyName` (repo-default unless overridden via `/nick`).
  - added `file` column sourced from the model ID basename (`*.gguf`).
  - added a gradient header row (`Backend | Provider | Name | File | Size`).
  - adjusted width allocation to prioritize readability with dynamic `name`/`file` distribution and less cramped fixed columns.
  - simplified size cell to a compact `x.xG` format.
- Updated `src/tui.ts` model-manager navigation viewport size from `12` to `11` rows so keyboard scrolling matches visible list rows after header insertion.
- Updated `tests/model-manager-ui.test.ts`:
  - asserts header labels are present.
  - asserts row order and values include backend/provider/name(file nickname default)/file columns.
    Validation:
- `npm test -- tests/model-manager-ui.test.ts` — clean (3 passing)
- `npm test -- tests/model-manager-ui.test.ts tests/model-manager.test.ts` — initially failed due to empty-list header expectation; fixed and re-ran targeted UI test cleanly
- `npm test -- tests/tui-resize-render.test.ts tests/tui-busy-indicator.test.ts` — clean (25 passing)
- `npm run typecheck` — clean
- `npm run lint -- src/model-manager-ui.ts tests/model-manager-ui.test.ts src/tui.ts` — clean
  Next:
- Optional interactive pass in `npm run dev` to verify column readability at narrow and wide terminal widths and confirm scroll behavior feels correct with header row present.
