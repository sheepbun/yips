"""
Gateway tool schemas (OpenAI function-calling format) and safe executor.

Provides file read/write/edit capabilities for Discord users with edit permission,
routed through the llama.cpp OpenAI-compatible API.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from cli.tool_execution import is_in_working_zone

# ---------------------------------------------------------------------------
#  Safety constants
# ---------------------------------------------------------------------------

MAX_TOOL_ITERATIONS = 10
_MAX_READ_LINES = 500
_MAX_READ_BYTES = 32_768  # 32 KB

# ---------------------------------------------------------------------------
#  Tool schemas — OpenAI function-calling format
# ---------------------------------------------------------------------------

_READ_FILE = {
    "type": "function",
    "function": {
        "name": "read_file",
        "description": "Read the contents of a file. Output is truncated to 500 lines / 32 KB.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file to read.",
                },
            },
            "required": ["path"],
        },
    },
}

_LIST_FILES = {
    "type": "function",
    "function": {
        "name": "list_files",
        "description": "List the contents of a directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the directory to list.",
                },
            },
            "required": ["path"],
        },
    },
}

_WRITE_FILE = {
    "type": "function",
    "function": {
        "name": "write_file",
        "description": "Create or overwrite a file with the given content.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file to write.",
                },
                "content": {
                    "type": "string",
                    "description": "The full content to write to the file.",
                },
            },
            "required": ["path", "content"],
        },
    },
}

_EDIT_FILE = {
    "type": "function",
    "function": {
        "name": "edit_file",
        "description": "Find and replace a string in an existing file.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or relative path to the file to edit.",
                },
                "old_string": {
                    "type": "string",
                    "description": "The exact string to find in the file.",
                },
                "new_string": {
                    "type": "string",
                    "description": "The string to replace it with.",
                },
            },
            "required": ["path", "old_string", "new_string"],
        },
    },
}

GATEWAY_TOOLS_READ_ONLY: list[dict] = [_READ_FILE, _LIST_FILES]
GATEWAY_TOOLS_EDIT: list[dict] = [_READ_FILE, _LIST_FILES, _WRITE_FILE, _EDIT_FILE]

# ---------------------------------------------------------------------------
#  Executor
# ---------------------------------------------------------------------------


def _resolve_path(raw: str) -> Path:
    """Resolve a user-supplied path (relative paths anchored to cwd)."""
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def execute_gateway_tool(name: str, arguments: dict, can_edit: bool) -> str:
    """Execute a gateway tool call and return a plain-text result string.

    Returns error descriptions (not exceptions) so the model can recover.
    """
    allowed_names = {"read_file", "list_files"}
    if can_edit:
        allowed_names |= {"write_file", "edit_file"}

    if name not in allowed_names:
        return f"Error: tool '{name}' is not allowed (edit permission required)."

    try:
        if name == "read_file":
            return _exec_read_file(arguments)
        if name == "list_files":
            return _exec_list_files(arguments)
        if name == "write_file":
            return _exec_write_file(arguments)
        if name == "edit_file":
            return _exec_edit_file(arguments)
        return f"Error: unknown tool '{name}'."
    except Exception as exc:
        return f"Error executing {name}: {exc}"


# ---------------------------------------------------------------------------
#  Individual tool implementations
# ---------------------------------------------------------------------------


def _exec_read_file(args: dict) -> str:
    path = _resolve_path(args.get("path", ""))
    if not is_in_working_zone(path):
        return f"Error: path '{path}' is outside the working zone."
    if not path.is_file():
        return f"Error: '{path}' is not a file or does not exist."

    content = path.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines(keepends=True)
    if len(lines) > _MAX_READ_LINES:
        lines = lines[:_MAX_READ_LINES]
        truncated = True
    else:
        truncated = False

    result = "".join(lines)
    if len(result) > _MAX_READ_BYTES:
        result = result[:_MAX_READ_BYTES]
        truncated = True

    if truncated:
        result += f"\n... (truncated to {_MAX_READ_LINES} lines / {_MAX_READ_BYTES // 1024} KB)"
    return result


def _exec_list_files(args: dict) -> str:
    path = _resolve_path(args.get("path", ""))
    if not is_in_working_zone(path):
        return f"Error: path '{path}' is outside the working zone."
    if not path.is_dir():
        return f"Error: '{path}' is not a directory or does not exist."

    entries = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    lines: list[str] = []
    for entry in entries[:200]:  # cap at 200 entries
        suffix = "/" if entry.is_dir() else ""
        lines.append(f"{entry.name}{suffix}")
    result = "\n".join(lines)
    if len(entries) > 200:
        result += f"\n... ({len(entries)} total entries, showing first 200)"
    return result


def _exec_write_file(args: dict) -> str:
    path = _resolve_path(args.get("path", ""))
    content = args.get("content", "")
    if not is_in_working_zone(path):
        return f"Error: path '{path}' is outside the working zone."

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return f"OK: wrote {len(content)} bytes to {path}"


def _exec_edit_file(args: dict) -> str:
    path = _resolve_path(args.get("path", ""))
    old_string = args.get("old_string", "")
    new_string = args.get("new_string", "")
    if not is_in_working_zone(path):
        return f"Error: path '{path}' is outside the working zone."
    if not path.is_file():
        return f"Error: '{path}' is not a file or does not exist."
    if not old_string:
        return "Error: old_string must not be empty."

    content = path.read_text(encoding="utf-8", errors="replace")
    count = content.count(old_string)
    if count == 0:
        return "Error: old_string not found in file."

    new_content = content.replace(old_string, new_string, 1)
    path.write_text(new_content, encoding="utf-8")
    return f"OK: replaced 1 occurrence in {path}"
