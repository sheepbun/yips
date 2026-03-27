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
#  Discord read-only tool schemas
# ---------------------------------------------------------------------------

_DISCORD_GET_SERVER_CONTEXT = {
    "type": "function",
    "function": {
        "name": "discord_get_server_context",
        "description": (
            "Return a summary of the Discord server (guild) the current message came from, "
            "including name, id, and member count."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

_DISCORD_LIST_MEMBERS = {
    "type": "function",
    "function": {
        "name": "discord_list_members",
        "description": (
            "List members of the current Discord server.  "
            "Requires the 'members' privileged intent to be enabled.  "
            "To mention a listed member, embed <@ID> in your reply text — "
            "your reply IS the Discord message, so <@ID> produces a real @mention "
            "that notifies the user without any extra send step."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Optional substring filter on username or display name.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of members to return (default 25, max 100).",
                },
            },
            "required": [],
        },
    },
}

_DISCORD_GET_MEMBER = {
    "type": "function",
    "function": {
        "name": "discord_get_member",
        "description": (
            "Look up a single Discord server member by their ID (exact) or "
            "by a substring of their username / display name.  "
            "After calling this tool, embed <@ID> directly in your reply text "
            "to produce a real @mention — e.g. write '<@255176556945735683> hey!' "
            "and Discord will notify that user.  Your reply IS the Discord message, "
            "so this works without any extra send step."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "identifier": {
                    "type": "string",
                    "description": "A Discord user ID or a name substring to search for.",
                },
            },
            "required": ["identifier"],
        },
    },
}

_DISCORD_LIST_CHANNELS = {
    "type": "function",
    "function": {
        "name": "discord_list_channels",
        "description": "List all channels in the current Discord server.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

_DISCORD_LIST_ROLES = {
    "type": "function",
    "function": {
        "name": "discord_list_roles",
        "description": "List all roles defined in the current Discord server.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}

_DISCORD_FORMAT_MENTION = {
    "type": "function",
    "function": {
        "name": "discord_format_mention",
        "description": (
            "Given a Discord user ID, returns the mention tag that — when included "
            "verbatim in your reply — will ping that user in Discord.  "
            "Workflow: (1) call discord_get_member to find the user's id field, "
            "(2) call discord_format_mention with that id, "
            "(3) paste the returned string directly into your response.  "
            "Example return value: '<@255176556945735683>'  "
            "You MUST include the return value in your reply for the ping to work."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_id": {
                    "type": "string",
                    "description": "The Discord user ID (numeric string) to format.",
                },
            },
            "required": ["user_id"],
        },
    },
}

GATEWAY_TOOLS_DISCORD_READ_ONLY: list[dict] = [
    _DISCORD_GET_SERVER_CONTEXT,
    _DISCORD_LIST_MEMBERS,
    _DISCORD_GET_MEMBER,
    _DISCORD_LIST_CHANNELS,
    _DISCORD_LIST_ROLES,
    _DISCORD_FORMAT_MENTION,
]

# ---------------------------------------------------------------------------
#  Executor
# ---------------------------------------------------------------------------


def _resolve_path(raw: str) -> Path:
    """Resolve a user-supplied path (relative paths anchored to cwd)."""
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


_DISCORD_TOOL_NAMES = {
    "discord_get_server_context",
    "discord_list_members",
    "discord_get_member",
    "discord_list_channels",
    "discord_list_roles",
    "discord_format_mention",
}


def execute_gateway_tool(
    name: str,
    arguments: dict,
    can_edit: bool,
    message_context: dict | None = None,
) -> str:
    """Execute a gateway tool call and return a plain-text result string.

    Returns error descriptions (not exceptions) so the model can recover.
    """
    allowed_names = {"read_file", "list_files"}
    if can_edit:
        allowed_names |= {"write_file", "edit_file"}
    if message_context is not None:
        allowed_names |= _DISCORD_TOOL_NAMES

    if name not in allowed_names:
        if name in _DISCORD_TOOL_NAMES:
            return f"Error: tool '{name}' is only available in Discord conversations."
        return f"Error: tool '{name}' is not allowed (edit permission required)."

    if name in _DISCORD_TOOL_NAMES:
        return _execute_discord_tool(name, arguments, message_context)

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


def _execute_discord_tool(
    name: str, arguments: dict, message_context: dict | None
) -> str:
    """Dispatch a Discord read-only tool call.  Returns a JSON string or an error."""
    # Lazy import to avoid circular dependency: tools → runtime → service → bot → tools
    from cli.gateway import discord_runtime  # noqa: PLC0415

    if message_context is None:
        return "Error: Discord tools require a message_context."

    guild_id: str | None = message_context.get("guild_id")
    if guild_id is None:
        return (
            "Error: This is a direct message — server-level Discord tools are not "
            "available in DMs."
        )

    try:
        if name == "discord_get_server_context":
            result = discord_runtime.get_guild(guild_id)
            if result is None:
                return "Error: Guild not found or bot is not in that server."
            return json.dumps(result, indent=2)

        if name == "discord_list_members":
            query = arguments.get("query")
            raw_limit = arguments.get("limit", 25)
            try:
                limit = max(1, min(100, int(raw_limit)))
            except (TypeError, ValueError):
                limit = 25
            members = discord_runtime.list_members(guild_id, query=query, limit=limit)
            return json.dumps(members, indent=2)

        if name == "discord_get_member":
            identifier = arguments.get("identifier", "").strip()
            if not identifier:
                return "Error: 'identifier' is required for discord_get_member."
            member = discord_runtime.get_member(guild_id, identifier)
            if member is None:
                return f"No member found matching '{identifier}'."
            return json.dumps(member, indent=2)

        if name == "discord_list_channels":
            channels = discord_runtime.list_channels(guild_id)
            return json.dumps(channels, indent=2)

        if name == "discord_list_roles":
            roles = discord_runtime.list_roles(guild_id)
            return json.dumps(roles, indent=2)

        if name == "discord_format_mention":
            user_id = arguments.get("user_id", "").strip()
            if not user_id:
                return "Error: 'user_id' is required for discord_format_mention."
            # Returns the raw mention tag; the model includes this in its reply.
            return f"<@{user_id}>"

        return f"Error: unknown Discord tool '{name}'."

    except RuntimeError as exc:
        return f"Error: {exc}"
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
