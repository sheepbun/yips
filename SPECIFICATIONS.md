# Yips - Technical Specifications

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      AGENT.py                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Context   │  │ Conversation│  │  Tool Request   │ │
│  │   Loader    │  │    Loop     │  │    Handler      │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
         │                 │                   │
         ▼                 ▼                   ▼
┌─────────────────┐ ┌─────────────┐  ┌─────────────────┐
│  .md Documents  │ │  Claude CLI │  │   Skills (*.py) │
│  (personality,  │ │  subprocess │  │   (RENAME,      │
│   identity,     │ │  --print    │  │    MEMORIZE,    │
│   memories)     │ │  --resume   │  │    future...)   │
└─────────────────┘ └─────────────┘  └─────────────────┘
```

## Core Components

### Context Loader
Reads and assembles the system prompt from:
- `AGENT.md` - Soul document (personality, values, boundaries)
- `IDENTITY.md` - Evolving self-understanding
- `author/HUMAN.md` - Information about Katherine
- `memories/` - Recent conversation memories (most recent N files)

### Conversation Loop
1. Display prompt, accept user input
2. Send message to backend (llama.cpp, LM Studio, or Claude CLI)
3. Parse response for tool requests
4. Display response to user
5. Handle any tool requests autonomously (unless destructive)
6. Continue until user exits

### Tool Request Handler
Parses response text for protocol tags and executes actions.

## Tool Use Protocol

Yips requests actions using tagged format embedded in response text:

### File Operations

**Read a file:**
```
{ACTION:read_file:/absolute/path/to/file}
```

**Write a file:**
```
{ACTION:write_file:/absolute/path/to/file:content to write}
```

**Run a command:**
```
{ACTION:run_command:command --with --args}
```

### Skill Invocation

```
{INVOKE_SKILL:SKILLNAME:arguments}
```

Example:
```
{INVOKE_SKILL:RENAME:new_session_title}
```

### Identity Update

```
{UPDATE_IDENTITY:reflection text to append to IDENTITY.md}
```

## Confirmation Flow

Routine tool requests (file read/write, skills) are executed **autonomously** without asking.
Only **destructive commands** (matching certain patterns) require explicit user confirmation.

## Available Skills

### RENAME
Located at `skills/RENAME.py`
Renames the current session and updates the UI title box and footer in-place.

**Usage in conversation:**
```
{INVOKE_SKILL:RENAME:Cool New Title}
```

### MEMORIZE
Located at `skills/MEMORIZE.py`

**Commands:**
- `save <name> [content]` - Save current conversation or provided content
- `list` - List recent memories
- `read <name>` - Read a memory by partial name match

**Usage in conversation:**
```
{INVOKE_SKILL:MEMORIZE:save project_planning}
```

## Memory Format

Memory files are stored as:
```
memories/{TIMESTAMP}_{NAME}.md
```

Example: `memories/2026-02-01_14-30-22_project_discussion.md`
