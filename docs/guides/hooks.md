# Hooks

## Concept

Hooks are user-defined scripts that Yips executes at specific lifecycle points. They let you automate tasks around agent activity — for example, running a linter before the agent commits, or logging every file write to an audit trail.

Hooks are opt-in. Yips runs without any hooks configured. When a hook is registered for a lifecycle point, Yips calls it as a subprocess and waits for it to complete before continuing.

## Available Hook Points _(planned)_

The following hook points are planned for the TypeScript rewrite. None are implemented yet.

### Session Hooks

| Hook | Fires When | Use Case |
|------|------------|----------|
| `on-session-start` | A new session begins | Load project-specific context, check prerequisites |
| `on-session-end` | A session is saved/closed | Export conversation, trigger backup |

### File Hooks

| Hook | Fires When | Use Case |
|------|------------|----------|
| `on-file-write` | The agent writes or edits a file | Auto-format (Prettier/Biome), lint check |
| `on-file-read` | The agent reads a file | Audit logging, access control |

### Git Hooks

| Hook | Fires When | Use Case |
|------|------------|----------|
| `pre-commit` | Before the agent creates a git commit | Run tests, lint staged files, AI-powered code review |

<!-- TODO: Define hook configuration format (hooks section in config file vs. dedicated hooks directory). Define hook interface (arguments passed, expected return codes, stdout/stderr handling). -->

## Examples

### Pre-commit: AI-Powered Code Review

The existing yips-cli ships a pre-commit hook (`git_hooks/pre-commit`) that captures the staged diff and sends it to the Yips agent for optimization suggestions:

```sh
# In yips-cli, the hook:
# 1. Gets staged diff with `git diff --cached`
# 2. Sends the diff to the agent with a review prompt
# 3. Agent prints suggestions to stdout
```

In the TypeScript rewrite, this will be configured through the hooks system rather than manual git hook installation.

### Auto-format on File Write

```sh
# Hook: on-file-write
# Script receives the file path as an argument
#!/usr/bin/env bash
prettier --write "$1"
```

When the agent writes a file, the hook runs Prettier on it automatically, so the agent's output always matches your project's formatting rules.

### Lint Check on File Write

```sh
# Hook: on-file-write
#!/usr/bin/env bash
eslint "$1"
if [ $? -ne 0 ]; then
  echo "Lint errors found in $1" >&2
  exit 1
fi
```

A non-zero exit code from a hook signals a problem. The agent will be notified and can attempt to fix the issue.

<!-- TODO: Define how hook failures are communicated back to the agent (stderr capture, retry policy, max attempts). -->

## Configuration _(planned)_

<!-- TODO: Define hook configuration format. Likely either:
  Option A: A `hooks` section in the config file mapping hook points to script paths
  Option B: A `.yips/hooks/` directory with scripts named after hook points
-->

---

> Last updated: 2026-02-22
