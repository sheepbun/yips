# Slash Commands

Slash commands are user-facing commands typed directly into the Yips TUI input. They start with `/` and are handled locally — they do not go through the LLM.

## Command Reference

### Session Control

| Command          | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `/exit`, `/quit` | Exit Yips gracefully (saves session, stops llama.cpp server) |
| `/clear`, `/new` | Start a new conversation (clears history, reloads backend)   |
| `/sessions`      | Browse and load past sessions interactively                  |

### Model & Backend

| Command                    | Description                                                                    |
| -------------------------- | ------------------------------------------------------------------------------ |
| `/model`                   | Open the Model Manager (list local models, switch, delete, jump to downloader) |
| `/model <name>`            | Switch to a model by local exact/partial match, with free-form fallback        |
| `/download`, `/dl`         | Open the interactive model downloader                                          |
| `/download <hf_url>`       | Download a GGUF file from a direct `hf.co` / `huggingface.co` resolve URL      |
| `/backend`                 | Show current backend                                                           |
| `/backend <name>`          | Switch backend (`llamacpp` or `claude`)                                        |
| `/nick <model> <nickname>` | Set and persist a display nickname for a model                                 |
| `/tokens`                  | Show current token counter mode                                                |
| `/tokens auto`             | Use automatic max token calculation from available RAM after model load        |
| `/tokens <value>`          | Set manual max token value (supports `k` suffix, for example `32k`)            |
| `/update`                  | Check latest npm version and print guided upgrade commands (`@sheepbun/yips`) |

`/download` usage:

```text
/download
/download <hf_url>
/dl ...   # alias for /download
```

### Display & Behavior

| Command    | Description                                              |
| ---------- | -------------------------------------------------------- |
| `/verbose` | Toggle verbose mode (shows tool calls made by the agent) |
| `/stream`  | Toggle response streaming on/off                         |

### Skills & Tools

These commands invoke specialized capabilities. Some are agent-invocable (the agent can call them via `INVOKE_SKILL`), others are user-only.

| Command            | Description                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| `/help`            | Show available commands and tips                                          |
| `/search <query>`  | Search the web (DuckDuckGo)                                               |
| `/fetch <url>`     | Retrieve and display content from a URL                                   |
| `/grab <file>`     | Read a file's content into context                                        |
| `/memorize <fact>` | Save a fact to long-term memory                                           |
| `/memorize list`   | List recent long-term memories                                            |
| `/memorize read`   | Read a memory by id from `/memorize list`                                 |
| `/vt`              | Open the modal Virtual Terminal (`Esc Esc` or `Ctrl+Q` to return to chat) |

### Complete List

All commands recognized by yips-cli, carried forward to the TypeScript rewrite:

```
/backend    /clear      /dl         /download   /exit
/fetch      /grab       /help       /memorize   /model
/new        /nick       /quit       /search
/sessions   /stream     /tokens     /update     /verbose    /vt
```

`/memorize` usage:

```text
/memorize <fact>
/memorize list [limit]
/memorize read <memory_id>
```

`/update` currently prints dual-path npm guidance:

- Canonical: `npm install -g @sheepbun/yips@latest`
- Legacy/unscoped: `npm install -g yips@latest` (may be unavailable)

## Tab Autocompletion

Yips supports tab autocompletion for slash commands. Start typing `/` followed by any prefix and press Tab to complete:

```
/mod<Tab>  →  /model
/se<Tab>   →  /search   (or /sessions — shows both options)
/str<Tab>  →  /stream
```

Autocompletion is global — it triggers anywhere in the input buffer, not just at the start of a line.

## Custom Commands _(planned)_

In a future milestone, Yips will support user-defined commands. Custom commands will be TypeScript modules or scripts placed in a designated directory, automatically discovered and added to the command list and autocompletion.

<!-- TODO: Define custom command API and directory structure once the slash command system is implemented in TypeScript. -->

---

> Last updated: 2026-02-25
