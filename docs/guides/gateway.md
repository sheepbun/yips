# Gateway _(planned)_

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
| WhatsApp | Webhooks (Meta Business API) | App token + verify token | _(planned)_ |
| Telegram | Long polling or webhooks (Bot API) | Bot token | _(planned)_ |
| Discord | WebSocket gateway (Bot SDK) | Bot token | _(planned)_ |

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
- **Authentication**: Controls who can interact with the gateway (allowlist, API keys, or platform-level permissions)

### Headless Conductor

The same Conductor used by the TUI, running without terminal display. It receives messages from the Gateway Core, processes them through the agent system (context loading, LLM call, tool execution, response chaining), and returns the final response.

## Self-Hosting Requirements

<!-- TODO: Define concrete requirements once gateway implementation begins. -->

- A machine running the LLM backend (GPU recommended for reasonable response times)
- Network access for platform webhooks (static IP or reverse proxy for WhatsApp/Telegram webhooks, or use long polling to avoid inbound connections)
- Platform API credentials (WhatsApp Business account, Telegram bot token, Discord application)
- Persistent storage for session data

## Security Considerations

- **Authentication**: The gateway should only respond to authorized users. Implement an allowlist of sender IDs or require a passphrase in the first message.
- **Tool restrictions**: The gateway Conductor should have a more restricted tool set than the TUI. File writes, shell commands, and git operations are high-risk when triggered by remote messages. Consider a read-only or explicitly scoped tool policy for gateway sessions.
- **Rate limiting**: Messaging platforms can deliver high volumes. Rate limit per sender to prevent resource exhaustion.
- **Input sanitization**: Messages from external platforms may contain injection attempts. Sanitize before passing to the Conductor.
- **No secrets in responses**: The agent's context may contain sensitive information (file contents, environment variables). Ensure the gateway does not leak this in responses to messaging platforms.

<!-- TODO: Define security model in detail. Decide on default tool policy (allowlist vs. denylist), authentication mechanism, and session isolation. -->

---

> Last updated: 2026-02-22
