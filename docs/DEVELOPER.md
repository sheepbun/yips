# Yips CLI — developer reference

This document complements [README.md](../README.md) and [ARCHITECTURE_DIAGRAM.md](../ARCHITECTURE_DIAGRAM.md) with concrete details on persistence, extending slash commands, and operations.

## 1. Persistence and on-disk layout

All paths below are resolved from the **project root** (`BASE_DIR` in [`cli/config.py`](../cli/config.py)), which comes from [`cli/root.py`](../cli/root.py): `YIPS_ROOT` env var, then `.yips-root`, then `.git`, then `AGENT.py` walking upward from `cli/`.

| Location | Purpose |
|----------|---------|
| [`.yips_config.json`](../.yips_config.json) | User settings: `backend`, `model`, `verbose`, `streaming`, etc. Loaded/saved by [`load_config` / `save_config`](../cli/config.py). |
| [`.yips/memory/`](../.yips/memory/) | Session transcripts as Markdown. CLI sessions are written by [`AgentSessionMixin.update_session_file`](../cli/agent/session.py) (`YYYY-MM-DD_HH-MM-SS_<slug>.md`). Discord uses the same folder with branded headers in [`discord_session.py`](../cli/gateway/discord_session.py). |
| [`.yips/plans/`](../.yips/plans/) | Plans created by the agent tool `create_plan` in [`tool_execution.py`](../cli/tool_execution.py). |
| `.yips/preferences.json` | Optional overrides (e.g. `max_context_tokens`) read in [`session.py`](../cli/agent/session.py) and surfaced in context from [`context.py`](../cli/agent/context.py). |
| `.yips/FOCUS.md` | Optional “current focus” section injected into the system prompt ([`context.py`](../cli/agent/context.py)). |
| `.yips/metrics.json` | If present, [`main.py`](../cli/main.py) increments `total_actions` / `successes` and `user_interventions`; the file is not created automatically by that path alone. |
| `.yips/logs/` | Created by setup scripts for log output (see [`scripts/setup.ps1`](../scripts/setup.ps1)). |
| `IDENTITY.md` (repo root) | Appended when the model emits `{UPDATE_IDENTITY:...}` ([`tool_execution.py`](../cli/tool_execution.py)). |

**Session file format (CLI):** Markdown with `# Session Memory`, `## Conversation`, optional `### Running Summary`, `### Archived Conversation`, and `### Active Conversation`. Roles are stored as `**Katherine**:` / `**Yips**:` / `*[System: ...]*`. Loading is implemented in [`load_session`](../cli/agent/session.py).

**Relational databases:** There is no SQL schema or migration layer in this repository; persistence is **file-based** under `.yips/` and selected repo markdown files.

**Environment:** `startup.sh` and `startup.bat` set `YIPS_PERSIST_BACKEND=1` and `YIPS_USER_CWD`. As of the current codebase, `YIPS_PERSIST_BACKEND` is **not read** by Python modules (reserved or legacy). `YIPS_USER_CWD` is used in [`info_utils.py`](../cli/info_utils.py) for display paths.

## 2. Slash commands and tool plugin contract

### Discovery

- **Tools:** subdirectories of [`commands/tools/`](../commands/tools/) — each command name is the **directory name** (matched case-insensitively).
- **Skills:** subdirectories of [`commands/skills/`](../commands/skills/).
- **Precedence:** For interactive `/command`, [`handle_slash_command`](../cli/commands.py) checks **tools first**, then **skills**.
- **Completion:** [`SlashCommandCompleter`](../cli/completer.py) scans both directories plus built-ins.

### Directory layout per command

For a command named `MYTOOL`:

- `commands/tools/MYTOOL/MYTOOL.py` — optional executable invoked as a script.
- `commands/tools/MYTOOL/MYTOOL.md` — optional markdown shown before the script runs (skills often use this for instructions).

The same pattern applies under `commands/skills/`. The script filename must match the folder name (e.g. `SEARCH/SEARCH.py`).

### How plugins are executed

**Interactive slash (`/foo args`):** [`commands.py`](../cli/commands.py) runs:

```text
<venv python> commands/.../FOO/FOO.py [split args...]
```

with `PYTHONPATH=<PROJECT_ROOT>`, timeout **30 seconds** (except see VT below).

**Model-invoked skills (`{INVOKE_SKILL:NAME:args}`):** [`execute_tool`](../cli/tool_execution.py) resolves `NAME` **uppercased**, looks for `commands/skills/NAME/NAME.py` then `commands/tools/NAME/NAME.py`, and runs the same way. The **VT** skill is special-cased: interactive `subprocess.run` without capture or timeout.

**Windows vs Unix:** Tool execution uses `.venv\Scripts\python.exe` on Windows and `.venv/bin/python3` on Unix when present ([`commands.py`](../cli/commands.py) and [`tool_execution.py`](../cli/tool_execution.py) use the same platform branch).

### Control protocol (stdout from plugins)

Plugins may print lines that the host interprets (stripped from displayed output):

| Line pattern | Effect |
|--------------|--------|
| `::YIPS_COMMAND::RENAME::<slug>` | Rename current session ([`rename_session`](../cli/agent/session.py)). |
| `::YIPS_COMMAND::EXIT::` | Graceful exit. |
| `::YIPS_COMMAND::REPROMPT::<message>` | Continue the agent loop with a follow-up. |

Example: [`commands/tools/EXIT/EXIT.py`](../commands/tools/EXIT/EXIT.py).

### Model tool tags (autonomous mode)

Parsed by [`parse_tool_requests`](../cli/tool_execution.py) (outside code fences):

- `{ACTION:tool:params}` — built-in actions: `run_command`, `read_file`, `write_file`, `ls`, `grep`, `git`, `edit_file`, `create_plan`, etc.
- `{INVOKE_SKILL:SKILL:args}` — run a plugin script as above.
- `{UPDATE_IDENTITY:reflection}` — append to `IDENTITY.md`.
- `{THOUGHT:signature}` — thought signature for the agent state.
- Claude Code-style `<|channel|>...<|message|>{...}` blocks are normalized into actions or `SEARCH` where possible.

Displayed text is cleaned with [`clean_response`](../cli/tool_execution.py).

### Built-in slash commands (not filesystem plugins)

Handled in [`handle_slash_command`](../cli/commands.py): `exit`, `quit`, `model`/`models`, `backend`, `sessions`, `nick`, `clear`, `new`, `verbose`, `stream`, `download`/`dl`, `gateway`/`gw`, plus dynamic tool/skill names.

## 3. Operations runbook

### First-time setup

1. **Unix/macOS:** `./startup.sh` — runs [`scripts/setup.sh`](../scripts/setup.sh), then `.venv/bin/python3 -m cli.main`.
2. **Windows:** `startup.bat` — runs [`scripts/setup.ps1`](../scripts/setup.ps1), then `.venv\Scripts\python.exe -m cli.main`.

Setup typically:

- Creates `.venv` and installs [`requirements.txt`](../requirements.txt) (with a hash cache under `.yips` on Windows).
- Ensures `.yips_config.json` exists (defaults: backend `claude`, model `sonnet`, verbose/streaming on — see setup scripts).
- Creates `.yips/memory`, `.yips/logs` (Windows), and optionally `.yips` for dependency hashing.
- Checks for `claude` on PATH (Claude CLI backend).
- Ensures **llama.cpp**:
  - **Linux/macOS:** clone/update `$HOME/llama.cpp` (or `LLAMA_DIR` in setup), CMake build with optional CUDA ([`cli/hw_utils.py`](../cli/hw_utils.py)), symlink `llama-server` into `~/.local/bin` when possible.
  - **Windows:** `%USERPROFILE%\llama.cpp`, search common build output paths for `llama-server.exe`, rebuild via [`cli.setup.install_llama_server`](../cli/setup.py) when missing or non-CUDA with NVIDIA present.
- Ensures a default **GGUF** under `%USERPROFILE%\.yips\models` (Windows) or the equivalent flow on Unix (see [`download_default_model`](../cli/setup.py)).

### Switching backends

- In-session: `/backend` with no args shows the current backend; `/backend claude` or `/backend llamacpp` switches, updates `.yips_config.json`, reinitializes the backend, and starts a **new session** ([`handle_backend_command`](../cli/commands.py)).
- Valid values in code today: **`claude`**, **`llamacpp`**. LM Studio and other paths may appear in docs but routing is implemented around these backends in [`cli/agent/backend.py`](../cli/agent/backend.py).

### Manual launch (without startup scripts)

From the repo root, with venv activated:

```bash
python -m cli.main
```

Or: `python AGENT.py`. Ensure `PYTHONPATH` includes the repo root (startup scripts set this implicitly via cwd + module path).

### Discord gateway

`/gateway` (or `/gw`) opens the gateway UI ([`cli/gateway/gateway_ui.py`](../cli/gateway/gateway_ui.py)). Discord sessions share `.yips/memory/` with the CLI format extensions described in [`discord_session.py`](../cli/gateway/discord_session.py).

---

For request/response streaming flows, see [ARCHITECTURE_DIAGRAM.md](../ARCHITECTURE_DIAGRAM.md). For UI spinner/token behavior, see [IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md).
