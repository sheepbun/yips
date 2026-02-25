## 2026-02-25 15:21 MST — Exchange 183

Summary: Added an interactive `/setup` menu in the TUI to configure gateway bot tokens for WhatsApp, Telegram, and Discord.

Changed:

- Extended config schema with channel token storage:
  - `src/types/app-types.ts`: added `GatewayChannel`, `GatewayChannelConfig`, `GatewayChannelsConfig`, and `AppConfig.channels`.
  - `src/config/config.ts`:
    - default config now includes `channels.whatsapp/telegram/discord.botToken`.
    - merge normalization now accepts and sanitizes `channels` values from config file.
    - env overrides now support:
      - `YIPS_WHATSAPP_BOT_TOKEN`
      - `YIPS_TELEGRAM_BOT_TOKEN`
      - `YIPS_DISCORD_BOT_TOKEN`
- Added `/setup` slash command:
  - `src/agent/commands/commands.ts`: new `uiAction` type `open-setup`, new `setup` command handler, help/autocomplete integration through registry.
  - `src/agent/commands/command-catalog.ts`: restored defaults now include `setup` descriptor.
- Added setup UI mode in the TUI runtime:
  - `src/ui/tui/runtime-core.ts`:
    - new `uiMode: "setup"` and runtime setup state.
    - dispatch handling for `open-setup`.
    - input routing for setup mode:
      - `↑/↓` select channel
      - `Enter` enter edit/save token
      - `Esc` cancel edit or close setup mode
    - persisted config save on token submit with feedback/error output.
    - status text now shows `setup · channels` while active.
    - setup mode suppresses slash autocomplete overlay.
    - setup panel rendering integrated into output area.
  - `src/ui/tui/layout.ts`: prompt-status union/status text updated for new `setup` mode.
  - new files:
    - `src/ui/setup/setup-state.ts`
    - `src/ui/setup/setup-ui.ts`
- Documentation:
  - `docs/roadmap.md`: built-in commands list now includes `/setup`.

Tests added/updated:

- `tests/agent/commands/commands.test.ts`:
  - verifies registry includes `setup`.
  - verifies `/setup` returns `uiAction: { type: "open-setup" }`.
- `tests/config/config.test.ts`:
  - verifies env overrides for the three channel bot token env vars.
  - verifies file-based channels normalization.
- new setup unit tests:
  - `tests/ui/setup/setup-state.test.ts`
  - `tests/ui/setup/setup-ui.test.ts`
- `tests/ui/tui/tui-busy-indicator.test.ts`:
  - updated typed config fixtures for new `channels` config field.

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/agent/commands/commands.test.ts tests/config/config.test.ts tests/ui/setup/setup-state.test.ts tests/ui/setup/setup-ui.test.ts tests/ui/tui/tui-busy-indicator.test.ts` — clean

Next:

- Wire gateway runtime entrypoints to optionally consume `config.channels.*.botToken` as a fallback when env vars are unset, so `/setup` values can be used directly at runtime.
