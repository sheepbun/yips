# Project Tree

This page is the canonical map of the current TypeScript code layout.

## Source Tree (`src/`)

```text
src/
  app/
    index.ts
    repl.ts
    version.ts
  agent/
    conductor.ts
    commands/
      command-catalog.ts
      commands.ts
    context/
      code-context.ts
      memory-store.ts
      session-store.ts
    protocol/
      tool-protocol.ts
    skills/
      skills.ts
    tools/
      tool-executor.ts
      tool-safety.ts
  config/
    config.ts
    hooks.ts
  gateway/
    auth-policy.ts
    adapters/
      discord.ts
      formatting.ts
      whatsapp.ts
      telegram.ts
      types.ts
    runtime/
      discord-bot.ts
      discord-main.ts
    core.ts
    message-router.ts
    rate-limiter.ts
    session-manager.ts
    types.ts
  llm/
    llama-client.ts
    llama-server.ts
    token-counter.ts
  models/
    hardware.ts
    model-downloader.ts
    model-manager.ts
  types/
    app-types.ts
  ui/
    colors.ts
    messages.ts
    spinner.ts
    title-box.ts
    downloader/
      downloader-state.ts
      downloader-ui.ts
    input/
      input-engine.ts
      tui-input-routing.ts
      vt-session.ts
    model-manager/
      model-manager-state.ts
      model-manager-ui.ts
    prompt/
      prompt-box.ts
      prompt-composer.ts
    tui/
      app.ts
      runtime-core.ts
      autocomplete.ts
      constants.ts
      history.ts
      layout.ts
      runtime-utils.ts
      start-tui.ts
      startup.ts
```

## Test Tree (`tests/`)

Tests now mirror the source layout so behavior and implementation stay easy to navigate together.

```text
tests/
  app/
  agent/
  config/
  gateway/
  llm/
  models/
  ui/
```

## Navigation Guide

- App startup and process entry: `src/app/`
- Agent orchestration, tools, skills, and command protocol: `src/agent/`
- Runtime config and lifecycle hooks: `src/config/`
- Gateway routing/session/rate-limit core: `src/gateway/`
- LLM transport and server lifecycle: `src/llm/`
- Local model discovery, download, and hardware fit: `src/models/`
- Ink UI and input/render systems: `src/ui/`

## Import Aliases

Runtime-safe Node `#imports` aliases are defined in `package.json` and mirrored in `tsconfig.json` paths:

- `#app/*`
- `#agent/conductor`
- `#agent/commands/*`
- `#agent/context/*`
- `#agent/protocol/*`
- `#agent/skills/*`
- `#agent/tools/*`
- `#config/*`
- `#gateway/*`
- `#llm/*`
- `#models/*`
- `#types/*`
- `#ui/*`
- `#ui/prompt/*`
- `#ui/input/*`
- `#ui/downloader/*`
- `#ui/model-manager/*`
- `#ui/tui/*`

Use aliases for cross-domain imports and keep local imports explicit by domain path.

---

> Last updated: 2026-02-25
