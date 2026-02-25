# Hooks

## Concept

Hooks are user-defined scripts that Yips executes at specific lifecycle points. They let you automate tasks around agent activity — for example, running a linter before the agent commits, or logging every file write to an audit trail.

Hooks are opt-in. Yips runs without any hooks configured. When a hook is registered for a lifecycle point, Yips calls it as a subprocess and waits for it to complete before continuing.

## Available Hook Points

| Hook | Fires When | Args | Use Case |
|------|------------|------|----------|
| `on-session-start` | A new session begins | none | Load project-specific context, check prerequisites |
| `on-session-end` | A session is saved/closed | none | Export conversation, trigger backup |
| `on-file-write` | The agent writes or edits a file | `<filepath>` | Auto-format (Prettier/Biome), lint check |
| `on-file-read` | The agent reads a file | `<filepath>` | Audit logging, access control |
| `pre-commit` | Before the agent creates a git commit | none | Run tests, lint staged files, AI-powered code review |

## Configuration

Hooks are configured via a directory of executable scripts at `~/.yips/hooks/`. Scripts must be named after the lifecycle event, with an optional `.sh` extension:

```
~/.yips/hooks/
  on-file-write.sh   # runs after every file write
  pre-commit         # runs before every git commit
  on-session-start   # runs when yips starts
```

To override the hooks directory, set the `YIPS_HOOKS_DIR` environment variable:

```sh
export YIPS_HOOKS_DIR=/path/to/my/hooks
```

Each script must be executable (`chmod +x`). Non-executable files are silently skipped.

To list registered hooks, run `/hooks` inside Yips.

## Hook Interface

- **Arguments**: passed as positional shell arguments (e.g., `$1` for the file path in `on-file-write`)
- **Exit code 0**: success — Yips continues normally
- **Non-zero exit code**: failure — Yips appends the hook's stderr to the relevant tool output so the agent can react
- **stdout**: captured but not forwarded to the agent (reserved for future use)
- **stdin**: closed (hooks receive no interactive input)

## Examples

### Auto-format on File Write

```sh
#!/usr/bin/env bash
# ~/.yips/hooks/on-file-write.sh
# Runs Prettier on every file the agent writes
prettier --write "$1"
```

### Lint Check on File Write

```sh
#!/usr/bin/env bash
# ~/.yips/hooks/on-file-write.sh
eslint "$1"
if [ $? -ne 0 ]; then
  echo "Lint errors found in $1" >&2
  exit 1
fi
```

A non-zero exit code from a hook signals a problem. The agent will be notified via the tool result and can attempt to fix the issue.

### Pre-commit: AI-Powered Code Review

```sh
#!/usr/bin/env bash
# ~/.yips/hooks/pre-commit
# Capture staged diff and fail if it looks problematic
diff=$(git diff --cached)
if echo "$diff" | grep -q "TODO: REMOVE"; then
  echo "Staged diff contains unresolved TODO: REMOVE markers" >&2
  exit 1
fi
```

### Session Start: Prerequisites Check

```sh
#!/usr/bin/env bash
# ~/.yips/hooks/on-session-start
# Ensure required tools are available
for tool in git node prettier; do
  if ! command -v "$tool" &>/dev/null; then
    echo "Required tool not found: $tool" >&2
    exit 1
  fi
done
```

---

> Last updated: 2026-02-25
