## 2026-02-25 12:46 MST — Exchange 175

Summary: Updated compact action-call styling so bullets and file/path segments render in blue.

Changed:

- Updated `src/ui/messages.ts`:
  - added `blue(...)` color helper using `GRADIENT_BLUE`.
  - added `formatActionCallLine(...)` to style action call rows with:
    - blue bullet marker (`●`),
    - blue file/path segments for file-based tools:
      - `read_file`
      - `list_dir`
      - `write_file`
      - `edit_file`
      - `grep` (`... in <path>` segment).
  - retained existing compact text content and output wording while changing color emphasis only.
- Validation:
  - `npm run typecheck` — clean.
  - `npm test -- tests/ui/messages.test.ts tests/ui/tui/tui-action-box-render.test.ts tests/ui/tui/tui-busy-indicator.test.ts` — clean.

Next:

- If desired, extend the same blue path emphasis to skill call lines that include paths (`todos`, etc.) for full visual consistency.
