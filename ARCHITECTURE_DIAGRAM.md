# Yips Streaming Architecture

## Request Flow Diagram

```
User Input
    │
    ├─ Slash Command? (/stream, /model, /verbose, /exit)
    │   └─> Handle command and return
    │
    └─ Regular Message
        │
        ├─> get_response(message)
            │
            ├─ Backend: LM Studio
            │   │
            │   └─> call_lm_studio(message)
            │       │
            │       ├─ Streaming Enabled?
            │       │   │
            │       │   ├─ YES → _stream_lm_studio()
            │       │   │         │
            │       │   │         ├─ Show "Yips: " prefix
            │       │   │         ├─ POST to /v1/messages with stream=true
            │       │   │         ├─ Parse SSE events with iter_lines()
            │       │   │         ├─ Live display: Update gradient per token
            │       │   │         ├─ Buffer tool calls
            │       │   │         └─ Display tool calls after completion
            │       │   │
            │       │   └─ NO → Non-streaming mode
            │       │             │
            │       │             ├─ Show loading spinner
            │       │             ├─ POST to /v1/messages
            │       │             ├─ Wait for complete response
            │       │             ├─ Display tool calls if verbose
            │       │             └─ Return text
            │       │
            │       └─ On Error → Fallback to non-streaming
            │
            └─ Backend: Claude CLI
                │
                └─> call_claude_cli(message)
                    │
                    ├─ Streaming Enabled?
                    │   │
                    │   ├─ YES → _stream_claude_cli()
                    │   │         │
                    │   │         ├─ Show "Yips: " prefix
                    │   │         ├─ Popen with line buffering
                    │   │         ├─ Read stdout line by line
                    │   │         ├─ Live display: Update gradient per line
                    │   │         ├─ Collect stderr for tool calls
                    │   │         └─ Display tool calls after completion
                    │   │
                    │   └─ NO → Non-streaming mode
                    │             │
                    │             ├─ Show loading spinner
                    │             ├─ subprocess.run() with capture_output
                    │             ├─ Wait for complete response
                    │             ├─ Display tool calls from stderr if verbose
                    │             └─ Return stdout
                    │
                    └─ On Error → Fallback to non-streaming
```

## Display Components

### Tool Call Display (Rich Tree + Panel)

```
Before (old):
  Tool: read_file
    path: /home/user/file.txt
    encoding: utf-8

After (new):
╭─ Tool Call ─────────────────────╮
│ read_file                       │
│  ├─ path: /home/user/file.txt   │
│  └─ encoding: utf-8             │
╰─────────────────────────────────╯
```

### Loading Spinner (Rich Spinner)

```
Before response arrives:
⠋ Waiting for response...
⠙ Waiting for response...
⠹ Waiting for response...
(clockwise_dots_8 custom animation)

After first token:
Spinner disappears (transient=True)
```

### Streaming Display (Rich Live)

```
Token 1:  Yips: Hello
Token 2:  Yips: Hello, I'm
Token 3:  Yips: Hello, I'm happy
Token 4:  Yips: Hello, I'm happy to
Token 5:  Yips: Hello, I'm happy to help!

Each update recalculates full gradient:
- Pink → Yellow gradient across entire text
- 20 fps refresh rate
- Smooth visual updates
```

## Configuration State

```json
{
  "backend": "lmstudio" | "claude",
  "model": "model-name",
  "verbose": true | false,
  "streaming": true | false  // NEW
}
```

## Error Handling Flow

```
Try Streaming Mode
    │
    ├─ Success → Display streamed output
    │
    └─ Error → Print warning
              └─ Fallback to Non-Streaming Mode
                  │
                  ├─ Success → Display complete output
                  │
                  └─ Error → Display error message
```

## Key Implementation Details

### Streaming Methods

**LM Studio (_stream_lm_studio):**
- Uses `requests.post()` with `stream=True`
- Parses SSE format: `data: {json}\n\n`
- Handles `text_delta` and `tool_use` content blocks
- Accumulates text tokens for display
- Buffers tool calls until stream completes

**Claude CLI (_stream_claude_cli):**
- Uses `subprocess.Popen()` with `bufsize=1`
- Reads stdout line-by-line with `readline()`
- Collects stderr for tool call information
- Accumulates text for display
- Displays tool calls after process completes

### Gradient Application

```python
def apply_gradient_to_text(text: str) -> Text:
    """Apply pink->yellow gradient to text for streaming display."""
    return gradient_text(text)  # Reuses existing gradient_text()
```

Each token triggers:
1. Append to accumulated_text
2. Recalculate full gradient across accumulated_text
3. Update Live display with new styled Text object

### Tool Call Formatting

```python
def _format_tool_call_tree(tool_name, tool_input) -> Tree:
    tree = Tree(f"[cyan]{tool_name}[/cyan]")
    for key, value in tool_input.items():
        value_str = str(value)
        if len(value_str) > 80:
            value_str = value_str[:77] + "..."
        tree.add(f"[dim]{key}:[/dim] {value_str}")
    return tree
```

Wrapped in Panel with cyan dim border for visual consistency.

## Performance Considerations

- **Gradient Recalculation**: O(n) per token, acceptable for <2k tokens
- **Live Refresh Rate**: 20 fps balances smoothness and CPU usage
- **Network Buffering**: SSE events buffered by requests library
- **Subprocess Buffering**: Line buffering (bufsize=1) for minimal latency

## User Experience

1. **Default Mode**: Streaming enabled for real-time feedback
2. **Toggle Command**: `/stream` to switch modes on the fly
3. **Graceful Degradation**: Auto-fallback on streaming errors
4. **Visual Feedback**: Loading spinners when not streaming
5. **Tool Transparency**: Pretty tool call display in verbose mode
