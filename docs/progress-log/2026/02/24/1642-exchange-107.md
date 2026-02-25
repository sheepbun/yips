## 2026-02-24 16:42 MST — Exchange 107

Summary: Updated Model Manager table sizing to fill the full box width by distributing extra width across all columns.
Changed:

- Updated `src/model-manager-ui.ts` column allocator:
  - replaced capped dynamic `name/file` sizing with full-width column distribution.
  - table now computes minimum column widths and spreads additional width evenly across `backend`, `provider`, `name`, `file`, and `size`.
  - added narrow-terminal fallback that shrinks columns in priority order while preserving minimum readability.
- Updated `tests/model-manager-ui.test.ts`:
  - relaxed one row assertion to avoid brittleness from dynamic column spacing while still validating column order/content.
    Validation:
- `npm test -- tests/model-manager-ui.test.ts` — clean (3 passing)
- `npm run typecheck` — clean
- `npm run lint -- src/model-manager-ui.ts tests/model-manager-ui.test.ts` — clean
  Next:
- Optional visual pass in `npm run dev` to fine-tune min widths if you want a denser or more spacious default distribution.
