## 2026-02-24 13:14 MST — Exchange 85

Summary: Removed duplicate cancel-confirm options text in downloader popup.
Changed:

- Updated `src/downloader-ui.ts`:
  - cancel-confirm body now renders only the confirmation message (plus a blank spacer row), leaving controls only in the footer.
  - this removes duplicate `[Enter] Yes  [Esc] No` display while preserving downloader frame height.
    Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts` — clean (20 passing)
  Next:
- Optional visual check in `npm run dev` during an active download to confirm confirm-mode text appears exactly once.
