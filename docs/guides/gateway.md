# Gateway

## Concept

The Yips Gateway is a self-hosted service that bridges AI agents to messaging platforms. It lets you interact with the same Conductor/Subagent system that powers the TUI — but through WhatsApp, Telegram, Discord, or other messaging apps instead of a terminal.

The gateway runs on your hardware, alongside the LLM backend. Messages stay on your infrastructure. There is no cloud relay.

## Architecture

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│    WhatsApp      │   │    Telegram      │   │    Discord       │
│    Adapter       │   │    Adapter       │   │    Adapter       │
│                  │   │                  │   │                  │
│  Webhook ← Meta │   │  Long poll ← TG │   │  WebSocket ← DC │
└────────┬────────┘   └────────┬─────────┘   └────────┬────────┘
         │                     │                       │
         ▼                     ▼                       ▼
┌──────────────────────────────────────────────────────────────┐
│                       Gateway Core                           │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Message     │  │   Session    │  │   Rate Limiter    │  │
│  │   Router      │  │   Manager    │  │   + Auth          │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              Conductor (headless mode)                        │
│                                                              │
│  Same agent system as TUI — context loading, tool use,       │
│  memory, skills — but without terminal display               │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     LLM Backend                              │
│              llama.cpp / Claude CLI                           │
└──────────────────────────────────────────────────────────────┘
```

## Components

### Platform Adapters

Each messaging platform has its own adapter that handles protocol-specific concerns:

| Platform | Transport | Auth | Status |
|----------|-----------|------|--------|
| WhatsApp | Webhooks (Meta Business API) | App token + verify token | `Implemented` (adapter layer) |
| Telegram | Long polling or webhooks (Bot API) | Bot token | `Implemented` (adapter layer) |
| Discord | WebSocket gateway (Bot SDK) | Bot token | `Implemented` (adapter + runtime loop) |

An adapter's job is to:

1. Receive incoming messages in the platform's format
2. Normalize them into a common message structure
3. Forward to the Gateway Core
4. Receive the agent's response from the Gateway Core
5. Format it for the platform (markdown conversion, message splitting, media handling)

### Gateway Core

The central routing layer:

- **Message Router**: Maps incoming messages to the correct Conductor session based on sender identity and conversation context
- **Session Manager**: Creates, persists, and resumes Conductor sessions per user/channel
- **Rate Limiter**: Prevents abuse (per-user message limits, cooldowns)
- **Authentication**: Controls who can interact with the gateway (sender allowlist + optional passphrase handshake)

Current implementation status in TypeScript:

- `src/gateway/core.ts`: dispatch entrypoint that validates/authenticates/rate-limits and invokes a message handler callback.
- `src/gateway/auth-policy.ts`: allowlist + `/auth <passphrase>` policy with persistent sender auth state (`platform + sender` scoped).
- `src/gateway/message-router.ts`: inbound message normalization and validation.
- `src/gateway/session-manager.ts`: in-memory per-conversation session lifecycle (`platform + sender + channel`).
- `src/gateway/rate-limiter.ts`: in-memory fixed-window per-sender rate limiter.
- `src/gateway/types.ts`: shared gateway message/session/dispatch contracts.
- `src/gateway/adapters/types.ts`: common adapter contract for platform-specific inbound/outbound translation.
- `src/gateway/adapters/whatsapp.ts`: WhatsApp Cloud API adapter for webhook `entry/changes/messages` parsing and Graph API `/messages` outbound formatting.
- `src/gateway/adapters/telegram.ts`: Telegram Bot API adapter for parsing webhook/poll updates into gateway messages and formatting `sendMessage` payloads.
- `src/gateway/adapters/discord.ts`: Discord adapter for message-create event normalization and outbound API payload formatting with safe chunking.
- `src/gateway/runtime/discord-bot.ts`: discord.js event loop that routes messages through `GatewayCore` and emits outbound requests.
- `src/gateway/runtime/discord-main.ts`: executable Discord runtime entrypoint (`npm run gateway:discord`).

Discord runtime environment variables:

- `YIPS_DISCORD_BOT_TOKEN` (required): Discord bot token used for gateway and outbound message authorization.
- `YIPS_GATEWAY_ALLOWED_SENDERS` (optional): comma-delimited sender ID allowlist enforced by `GatewayCore`.
- `YIPS_GATEWAY_PASSPHRASE` (optional): when set, senders must first send `/auth <passphrase>` before normal messages are processed.

Authentication behavior:

- If `YIPS_GATEWAY_ALLOWED_SENDERS` is set, non-allowlisted sender IDs are rejected.
- If `YIPS_GATEWAY_PASSPHRASE` is set, unauthenticated senders receive an explicit denial response until they send a valid `/auth <passphrase>` command.
- Successful `/auth` grants in-memory access for that sender within the current process lifetime.

### Headless Conductor

The same Conductor used by the TUI, running without terminal display. It receives messages from the Gateway Core, processes them through the agent system (context loading, LLM call, tool execution, response chaining), and returns the final response.

## Self-Hosting Requirements

- A machine running the LLM backend (GPU recommended for reasonable response times)
- Network access for platform webhooks (static IP or reverse proxy for WhatsApp/Telegram webhooks, or use long polling to avoid inbound connections)
- Platform API credentials (WhatsApp Business account, Telegram bot token, Discord application)
- Persistent storage for session data (currently in-memory session manager; durable persistence still pending)

## Security Considerations

- **Authentication**: Current implementation supports sender allowlists and optional passphrase handshake. Rotate passphrases regularly and prefer allowlist + passphrase together for public endpoints.
- **Tool restrictions**: The gateway Conductor should have a more restricted tool set than the TUI. File writes, shell commands, and git operations are high-risk when triggered by remote messages. Consider a read-only or explicitly scoped tool policy for gateway sessions.
- **Rate limiting**: Messaging platforms can deliver high volumes. Rate limit per sender to prevent resource exhaustion.
- **Input sanitization**: Messages from external platforms may contain injection attempts. Sanitize before passing to the Conductor.
- **No secrets in responses**: The agent's context may contain sensitive information (file contents, environment variables). Ensure the gateway does not leak this in responses to messaging platforms.

---

> Last updated: 2026-02-25
