# Phase 1: Agent Engine

Last verified: 2026-02-27

## Goal
Implement the ReAct turn engine, tool execution, and conductor pattern for multi-round agentic conversations.

## Dependencies
Phase 0

## Crates Touched
- `yips-tools` (create)
- `yips-skills` (create)
- `yips-agent` (create)

## Tasks
- [x] Implement Tool trait and built-in tools (read_file, write_file, edit_file, grep, run_command, list_dir)
- [x] Implement ToolRegistry
- [x] Implement skill manifest parsing and discovery
- [x] Implement skill subprocess runner with JSON protocol
- [x] Implement envelope parser for LLM responses
- [x] Implement TurnEngine with ReAct loop
- [x] Implement Conductor for system prompt composition and LLM dispatch
- [x] Define AgentDependencies trait for testability

## Key Types
- `Tool` trait, `ToolRegistry`
- `SkillManifest`, `Skill`, `SkillRunner`
- `TurnEngine`, `TurnConfig`, `TurnResult`
- `Conductor`, `AgentDependencies`
- `AgentEvent` (callback enum for streaming events)

## Files to Port From
- `yips-tui/src/agent/core/turn-engine.ts`
- `yips-tui/src/agent/core/contracts.ts`
- `yips-tui/src/agent/protocol/agent-envelope.ts`
- `yips-tui/src/agent/conductor.ts`

## Deliverable
Integration test runs a multi-round conversation that reads a file and summarizes it.

## Status
Complete
