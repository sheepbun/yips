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
│  (personality,  │ │  subprocess │  │   (MEMORIZE,    │
│   identity,     │ │  --print    │  │    future...)   │
│   memories)     │ │  --resume   │  │                 │
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
2. Send message to Claude CLI via subprocess
3. Parse response for tool requests
4. Display response to user
5. Handle any tool requests with confirmation
6. Continue until user exits

### Tool Request Handler
Parses response text for protocol tags, confirms with user, executes approved actions.

## Claude CLI Integration

**Base command:**
```bash
claude --print --output-format json --system-prompt "..."
```

**With session persistence:**
```bash
claude --print --output-format json --system-prompt "..." --resume {session_id}
```

**Response format (JSON):**
```json
{
  "result": "response text here",
  "session_id": "abc123...",
  ...
}
```

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
{INVOKE_SKILL:MEMORIZE:save conversation_name}
```

### Identity Update

```
{UPDATE_IDENTITY:reflection text to append to IDENTITY.md}
```

## Confirmation Flow

All tool requests follow this flow:

1. AGENT.py detects protocol tag in response
2. Displays action details to user:
   ```
   [Yips wants to: run_command]
   Command: ls -la /home/katherine

   Allow? (y/N):
   ```
3. Waits for user input
4. Only executes on explicit `y` or `yes`
5. Reports result back to conversation context

## Memory Format

Memory files are stored as:
```
memories/{TIMESTAMP}_{NAME}.md
```

Example: `memories/20260131_143022_project_discussion.md`

### Memory File Structure
```markdown
# Memory: {name}

**Created**: {timestamp}
**Session ID**: {session_id}

## Summary
{AI-generated summary of conversation}

## Key Points
- Point 1
- Point 2

## Context
{Any relevant context}
```

## Available Skills

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

## Security Considerations

- All file operations restricted to confirmation flow
- Commands executed via subprocess with shell=False where possible
- No automatic execution of any system-modifying action
- User must explicitly approve each action

## Configuration

### Session Persistence
Sessions are persisted via Claude CLI's `--resume` flag using stored session IDs.

### Memory Limits
- Recent memories loaded: 5 most recent by default
- Memory file size: No hard limit, but summarization encouraged

## Error Handling

- Claude CLI errors: Display to user, continue conversation
- File operation errors: Report error, don't crash
- Skill errors: Capture stderr, report to user
- Invalid protocol tags: Ignore, treat as regular text

## Future Extensibility

### Adding New Skills
1. Create `skills/SKILLNAME.py`
2. Implement CLI interface: `python SKILLNAME.py <command> [args]`
3. Document in skill file
4. Yips automatically discovers available skills

### Adding New Tools
1. Add handler in AGENT.py `execute_tool()` method
2. Document protocol in this specification
3. Update AGENT.md if behavior guidance needed
