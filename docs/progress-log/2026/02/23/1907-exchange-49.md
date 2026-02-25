## 2026-02-23 19:07 MST — Exchange 49

Summary: Fixed remaining downloader border break during loading by removing wide glyph usage in loading/download lines.
Changed:

- Updated `src/downloader-ui.ts` loading/downloading copy to avoid the wide `⏳` glyph, which could exceed terminal cell calculations and push right borders.
  - `⏳ ...` -> `Loading: ...`
  - `⏳ Downloading ...` -> `Downloading ...`
- Kept fixed-row body rendering logic unchanged; only width-safe text rendering changed.
  Validation:
- `npm test -- tests/downloader-ui.test.ts tests/downloader-state.test.ts` — clean
- `npm run lint -- src/downloader-ui.ts` — clean
  Next:
- If border artifacts persist in specific terminals/fonts, add display-width-aware string measurement (wcwidth-based) instead of codepoint counting in `src/downloader-ui.ts`.
