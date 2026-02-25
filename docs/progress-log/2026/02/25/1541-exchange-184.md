## 2026-02-25 15:41 MST — Exchange 184

Summary: Embedded Discord gateway runtime into normal Yips app lifecycle so it can run in the background, and added config-token fallback support for Discord runtime startup.

Changed:

- Added app-integrated background gateway launcher:
  - new `src/gateway/background.ts`:
    - resolves Discord bot token from env first (`YIPS_DISCORD_BOT_TOKEN`), then `config.channels.discord.botToken`.
    - wires `GatewayCore` + headless conductor + Discord runtime in-process.
    - applies optional auth envs (`YIPS_GATEWAY_ALLOWED_SENDERS`, `YIPS_GATEWAY_PASSPHRASE`).
    - returns an idempotent `stop()` handle for clean shutdown.
- Updated app entrypoint lifecycle:
  - `src/app/index.ts` now attempts to start background Discord gateway before entering TUI/REPL loop.
  - background runtime is always stopped in `finally` when the app exits or `/restart` cycles.
  - startup failures are surfaced as warnings without crashing Yips.
- Updated standalone Discord runtime token behavior:
  - `src/gateway/runtime/discord-main.ts` now accepts bot token from env or saved config (`channels.discord.botToken`), with explicit error when neither is configured.
- Documentation:
  - `docs/guides/gateway.md` now documents app background gateway behavior and env-vs-config token resolution.
  - `docs/changelog.md` updated with unreleased notes for background runtime + token fallback.

Tests added/updated:

- New `tests/gateway/background.test.ts`:
  - inactive behavior when no token exists
  - startup path with config token
  - env token precedence + auth env forwarding
  - headless cleanup on runtime startup failure

Validation:

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- tests/gateway/background.test.ts tests/gateway/runtime/discord-bot.test.ts tests/gateway/runtime/backend-policy.test.ts` — clean

Next:

- Extend background gateway lifecycle to Telegram/WhatsApp runtimes once their transport loops are wired, so `/setup` credentials can enable multi-platform in-process startup.
