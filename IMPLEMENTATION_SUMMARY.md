# Real-Time Loading Indicator with Token Counting and Reasoning Detection

## Implementation Complete ✅

This document summarizes the implementation of real-time token counting and reasoning detection for the Yips CLI loading indicator.

## What Was Implemented

### 1. Enhanced PulsingSpinner Class (`cli/ui_rendering.py`)

**New Attributes:**
- `input_tokens: int` - Tracks input tokens separately
- `output_tokens: int` - Tracks output tokens separately
- Both are summed into `token_count` for display

**New Methods:**
- `update_tokens(input_tokens: int = 0, output_tokens: int = 0)` - Updates token counts in real-time
- `update_status(status: str)` - Updates model status (thinking/reasoning/generating/using tools)

**Display Format:**
```
⣰ Thinking... (2m 6s · ↓ 5.6k tokens · reasoning)
```

### 2. Streaming LM Studio Handler (`cli/agent.py._stream_lm_studio`)

**New Event Handlers:**
- `message_start` → Extract input tokens
- `content_block_start` → Detect thinking/text/tool blocks and update status
- `content_block_delta` → Accumulate text and estimate output tokens
- `message_delta` → Get final accurate output token count

**Features:**
- Extracts actual input tokens from API
- Detects thinking blocks and updates status to "reasoning"
- Estimates output tokens during streaming (1 token ≈ 4 characters)
- Uses final accurate token count from message_delta event

### 3. Non-Streaming LM Studio Handler (`cli/agent.py.call_lm_studio`)

**Features:**
- Extracts and displays token usage from API response
- Detects thinking blocks in content
- Shows token info in verbose mode

### 4. Claude CLI Streaming Handler (`cli/agent.py._stream_claude_cli`)

**Features:**
- Initializes spinner with estimated token count
- Updates token count as text accumulates
- Shows "generating" status (Claude CLI doesn't support reasoning)

### 5. Token Estimation (`cli/agent.py._estimate_tokens`)

- Simple character-based: 1 token ≈ 4 characters
- Used for initial display
- Replaced with actual counts when available

## Status Transitions

```
Initial ("thinking")
    ↓
"reasoning" (if thinking block detected)
    ↓
"generating" (if text block detected)
    ↓
"using tools" (if tool_use block detected)
    ↓
Back to "generating"
```

## Key Features

✅ **Real-Time Token Counting**
- Input tokens from message_start event
- Output tokens estimated during streaming
- Final accurate output tokens from message_delta
- Dynamic updates on spinner

✅ **Thinking Block Detection**
- Detects `type: "thinking"` content blocks
- Updates status to "reasoning"
- Switches to "generating" for text blocks

✅ **Multiple Status Indicators**
- thinking, reasoning, generating, using tools

✅ **Token Display Formatting**
- Large numbers as: `5.6k` (not 5600)
- Format: `(elapsed · ↓ token_count · status)`

## Example Displays

**During Reasoning:**
```
⣰ Thinking... (0m 2s · ↓ 2.1k tokens · reasoning)
```

**During Generation:**
```
⣰ Generating response... (0m 5s · ↓ 5.6k tokens · generating)
```

**During Tool Use:**
```
⣰ Using tools... (0m 3s · ↓ 3.2k tokens · using tools)
```

## Backward Compatibility

✅ **Fully backward compatible:**
- Graceful fallback if API doesn't send usage data
- Works with models that don't support thinking blocks
- Existing code paths unchanged when features unavailable

## Files Modified

1. `cli/ui_rendering.py` - Enhanced PulsingSpinner
2. `cli/agent.py` - Added token tracking to all streaming/non-streaming handlers

## Testing

✅ All functionality tested:
- Token updates work correctly
- Status transitions work
- Token formatting works (0 to 10k+)
- State machine transitions verified
- All tests passed

## Performance

- No performance degradation
- Token updates are simple integer increments
- Live display at 20 FPS (existing rate)
- Minimal event parsing overhead

## Future Enhancements (Out of Scope)

- Separate input/output display: `↓ 2.1k in · ↑ 3.5k out`
- Cache info: `↓ 5.6k tokens (2.1k cached)`
- Cost estimation: `$0.023 estimated cost`
- Rate: `15 tokens/sec`

---

**Status:** Complete ✅ and Ready for Testing
**Backward Compatibility:** 100%
