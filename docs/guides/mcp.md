# MCP Integration

## What MCP Is

The [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is an open protocol for connecting AI assistants to external data sources and tools. It defines a standard way for an AI client to discover, invoke, and receive results from tool servers — without the client needing to know the implementation details of each tool.

MCP uses a client-server architecture:

- **MCP Server**: Exposes tools (functions the AI can call) and resources (data the AI can read). Examples: a filesystem server, a database server, a GitHub server.
- **MCP Client**: Connects to servers, discovers available tools/resources, and makes them available to the AI agent.

## Yips as MCP Client _(planned)_

Yips will act as an MCP client, connecting to user-configured MCP servers to extend the agent's capabilities without modifying Yips itself.

### Server Registration

<!-- TODO: Define MCP server configuration format. Likely a `servers` section in the Yips config file listing server names, transport (stdio, HTTP), and connection details. -->

```toml
# Example (config format TBD)
[mcp.servers.filesystem]
command = "npx @modelcontextprotocol/server-filesystem /home/user/projects"

[mcp.servers.github]
command = "npx @modelcontextprotocol/server-github"
env = { GITHUB_TOKEN = "..." }
```

### Tool Discovery

When Yips starts, it will connect to configured MCP servers and discover their available tools. These tools become available to the Conductor alongside Yips's native tools.

The agent sees MCP tools the same way it sees native tools — as callable functions with typed parameters and return values. The Conductor does not need to distinguish between native and MCP-provided tools.

### Context Injection

MCP servers can also expose resources — structured data that the agent can read into its context. Examples:

- A database schema from a PostgreSQL MCP server
- Open issues from a GitHub MCP server
- Documentation pages from a documentation MCP server

These resources will be loadable on demand, similar to how CODE.md is injected into context.

<!-- TODO: Define how MCP resources integrate with the context loading system. Likely available via a slash command or automatically loaded based on configuration. -->

## Comparison to Yips Native Tool Protocol

| Aspect | Yips Native Tools | MCP Tools |
|--------|-------------------|-----------|
| **Where they run** | Inside the Yips process | In separate MCP server processes |
| **Discovery** | Hardcoded in tool execution layer | Dynamic — discovered at startup via MCP protocol |
| **Configuration** | Built-in, no setup needed | User configures servers in config file |
| **Extension** | Requires modifying Yips source | Add a new MCP server, no Yips changes needed |
| **Protocol** | Action tags or structured calls (internal) | MCP protocol (JSON-RPC over stdio or HTTP) |
| **Ecosystem** | Yips-specific | Shared across all MCP-compatible clients |

The native tool protocol handles core operations (file I/O, shell commands, git) that need tight integration with the Yips process. MCP is for extending the agent with additional capabilities from the broader ecosystem.

In yips-cli, all tools are implemented as Python scripts in `commands/tools/` executed as subprocesses. The MCP approach is similar in spirit — tools run as separate processes — but uses a standardized protocol instead of a custom `::YIPS_COMMAND::` output format.

---

> Last updated: 2026-02-22
