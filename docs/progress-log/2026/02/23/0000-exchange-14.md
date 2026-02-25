## 2026-02-23 00:00 MST — Exchange 14

Summary: Migrated the interactive TUI from terminal-kit to Ink while preserving command dispatch, llama.cpp chat flow, and multiline prompt composition.
Changed:

- Updated dependencies:
  - removed `terminal-kit` and `@types/terminal-kit`
  - added `ink` and `react` (plus `@types/react` in dev dependencies)
- Updated TypeScript module settings in `tsconfig.json`:
  - `module` and `moduleResolution` switched to `Node16` so runtime `import("ink")` stays a native dynamic import in emitted CommonJS
- Replaced `src/tui.ts` implementation:
  - removed terminal-kit fullscreen/cursor drawing event loop
  - added Ink-based app renderer (`startTui()` now dynamically loads Ink and mounts a React component)
  - preserved prompt composer editing model (`PromptComposer`) with multiline support and Enter/CTRL+Enter behavior
  - preserved slash command handling (`/help`, `/clear`, `/model`, `/stream`, `/verbose`, `/exit`)
  - preserved llama.cpp request path including streaming updates and non-stream retry fallback
  - added pure prompt-frame helper `buildPromptRenderLines(...)` for deterministic render testing
  - retained and exported Ctrl+Enter sequence helpers (`normalizePromptComposerKey`, `isCtrlEnterUnknownSequence`)
- Updated tests:
  - rewrote `tests/tui-resize-render.test.ts` to validate prompt frame rendering via `buildPromptRenderLines(...)` instead of terminal-kit mocks
  - kept key-sequence coverage in `tests/tui-keys.test.ts`
- Updated docs for TUI framework change:
  - `docs/stack.md` (TUI framework section now Ink)
  - `docs/roadmap.md` decision log row for TUI framework
  - `docs/guides/getting-started.md` first-run TUI description
  - `docs/changelog.md` unreleased notes for terminal-kit → Ink migration
    Validation:
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — clean (108 passing)
- `npm run build` — clean
- `npm run format:check` — clean
  Next:
- Manually test interactive behavior in a real terminal (`npm run dev`) focusing on Ctrl+Enter newline insertion across your terminal emulator/keymap.
- If any terminal still fails to emit distinguishable Ctrl+Enter input, add an optional debug mode that logs raw stdin sequences for quick per-terminal mapping fixes.
