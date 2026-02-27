# Phase 0: Foundation

## Goal
Set up the Cargo workspace, core types, llama.cpp client, and configuration system.

## Dependencies
None

## Crates Touched
- `yips-core` (create)
- `yips-llm` (create)

## Tasks
- [x] Create Cargo workspace with all crate stubs
- [x] Implement shared types: ChatMessage, Role, ToolCall, ToolResult, ToolDefinition
- [x] Implement config loading from TOML
- [x] Implement IPC protocol types and length-prefixed JSON encoding
- [x] Implement llama.cpp HTTP client (streaming SSE + non-streaming)
- [x] Write unit tests for config, IPC roundtrip, message types

## Key Types
- `YipsConfig`, `LlmConfig`, `DaemonConfig`, `AgentConfig`
- `ChatMessage`, `Role`, `ToolCall`, `ToolResult`
- `ClientMessage`, `DaemonMessage` (IPC enums)
- `LlamaClient`, `ChatCompletion`, `ChatCompletionChunk`

## Deliverable
`cargo test` passes across all crates. LlamaClient can send a chat completion request to a running llama.cpp server.

## Status
In Progress
