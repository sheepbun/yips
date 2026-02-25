# Hooks

## Concept

Hooks are user-defined shell commands that Yips executes at specific lifecycle points.

Hooks are optional. If a hook is not configured, Yips skips it and continues normally.

## Implemented Hook Points

### Session Hooks

| Hook | Fires When |
|------|------------|
| `on-session-start` | TUI session boots |
| `on-session-end` | Session exits/restarts/cancels |

### File Hooks

| Hook | Fires When |
|------|------------|
| `on-file-write` | `write_file` or `edit_file` tool succeeds |

### Planned (Recognized, Not Fired Yet)

| Hook |
|------|
| `on-file-read` |
| `pre-commit` |

## Configuration

Configure hooks in your JSON config (`$YIPS_CONFIG_PATH` or `.yips_config.json`):

```json
{
  "hooks": {
    "on-session-start": {
      "command": "echo session-start"
    },
    "on-file-write": {
      "command": "./scripts/post-write.sh",
      "timeoutMs": 15000
    }
  }
}
```

- `command`: required shell command.
- `timeoutMs`: optional timeout in milliseconds.
- defaults to `10000`, max `120000`.

## Hook Input Contract

Each hook receives structured JSON on `stdin`:

```json
{
  "hook": "on-file-write",
  "eventId": "...",
  "timestamp": "2026-02-25T...Z",
  "cwd": "/path/to/project",
  "sessionName": "feature-session",
  "data": {
    "path": "/path/to/file.ts",
    "operation": "write_file"
  }
}
```

Hooks also receive environment variables:

- `YIPS_HOOK_NAME`
- `YIPS_HOOK_EVENT_ID`
- `YIPS_HOOK_TIMESTAMP`
- `YIPS_HOOK_CWD`
- `YIPS_HOOK_SESSION_NAME`
- `YIPS_HOOK_FILE_PATH`

## Failure Behavior

Hooks are **soft-fail**:

- Yips continues even if a hook exits non-zero or times out.
- Session hook failures are shown as warnings in the UI.
- `on-file-write` hook failures are included in tool output/metadata.

## Example: Auto-format On File Write

```sh
#!/usr/bin/env bash
# scripts/post-write.sh

# read hook payload from stdin if needed
payload="$(cat)"

# use env var for direct shell access
if [ -n "$YIPS_HOOK_FILE_PATH" ]; then
  prettier --write "$YIPS_HOOK_FILE_PATH"
fi
```

---

> Last updated: 2026-02-25
