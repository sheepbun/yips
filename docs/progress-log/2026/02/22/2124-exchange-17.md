## 2026-02-22 21:24 MST — Exchange 17

Summary: Fixed remaining Ink backspace instability by handling raw backspace bytes directly and filtering control characters from prompt text insertion.
Changed:

- Updated `src/tui.ts`:
  - added `countBackspaceUnknownSequence(chunk)` to detect/count raw backspace bytes (`0x08`, `0x7f`) from stdin
  - added `hasControlCharacters(input)` and gated character insertion so control bytes are ignored rather than inserted into prompt text
  - added raw-stdin backspace effect that dispatches `BACKSPACE` directly to `PromptComposer` and forces redraw
  - added `backspacePendingRef` de-dupe path so backspace is not applied twice when both stdin and Ink key events fire
- Updated `tests/tui-keys.test.ts`:
  - added coverage for `countBackspaceUnknownSequence(...)`
  - added coverage for `hasControlCharacters(...)`
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/tui-keys.test.ts tests/tui-resize-render.test.ts tests/prompt-composer.test.ts` — clean
- `npm test` — clean (114 passing)
- `npm run build` — clean
  Next:
- Manually verify in the interactive terminal that rapid backspacing no longer inserts control bytes or causes right-border drift.
