#!/usr/bin/env python3
"""
MEMORIZE - Memory management skill for Yips

Commands:
    save <name> [content]       - Save a memory with the given name
    export <name> <json>        - Export full conversation history (used by EXIT)
    list [limit]                - List recent memories (default: 10)
    read <name>                 - Read a memory by partial name match
"""

import sys
import json
from datetime import datetime
from pathlib import Path

from cli.config import MEMORIES_DIR


def sanitize_name(name: str) -> str:
    """Sanitize a name for use in filenames."""
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in name)


def save_memory(name: str, content: str = "") -> str:
    """Save a memory with timestamp prefix."""
    MEMORIES_DIR.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    safe_name = sanitize_name(name)
    filename = f"{timestamp}_{safe_name}.md"
    filepath = MEMORIES_DIR / filename

    memory_content = f"""# Memory: {name}

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

## Content

{content if content else "(Memory created - content to be added)"}
"""

    filepath.write_text(memory_content)
    return f"Memory saved: {filename}"


def export_conversation(name: str, history_json: str) -> str:
    """Export full conversation history to a memory file."""
    MEMORIES_DIR.mkdir(exist_ok=True)

    try:
        history = json.loads(history_json)
    except json.JSONDecodeError as e:
        return f"Error parsing conversation history: {e}"

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    safe_name = sanitize_name(name)
    filename = f"{timestamp}_{safe_name}.md"
    filepath = MEMORIES_DIR / filename

    # Format conversation
    conversation_lines = []
    for entry in history:
        role = entry.get("role", "unknown")
        content = entry.get("content", "")

        if role == "user":
            conversation_lines.append(f"**Katherine**: {content}")
        elif role == "assistant":
            conversation_lines.append(f"**Yips**: {content}")
        elif role == "system":
            # Truncate long system messages
            preview = content[:200] + "..." if len(content) > 200 else content
            conversation_lines.append(f"*[System: {preview}]*")

    memory_content = f"""# Memory: {name}

**Created**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Type**: Conversation Export

## Conversation

{chr(10).join(conversation_lines)}

---
*Automatically exported on session end*
"""

    filepath.write_text(memory_content)
    return f"Conversation exported: {filename}"


def list_memories(limit: int = 10) -> str:
    """List recent memories."""
    if not MEMORIES_DIR.exists():
        return "No memories directory found."

    memories = sorted(MEMORIES_DIR.glob("*.md"), reverse=True)

    if not memories:
        return "No memories saved yet."

    output = ["Recent memories:"]
    for mem in memories[:limit]:
        output.append(f"  - {mem.name}")

    if len(memories) > limit:
        output.append(f"  ... and {len(memories) - limit} more")

    return "\n".join(output)


def read_memory(query: str) -> str:
    """Read a memory by partial name match."""
    if not MEMORIES_DIR.exists():
        return "No memories directory found."

    query_lower = query.lower()
    matches = [
        m for m in MEMORIES_DIR.glob("*.md")
        if query_lower in m.name.lower()
    ]

    if not matches:
        return f"No memories matching '{query}' found."

    # Return the most recent match
    match = sorted(matches, reverse=True)[0]
    content = match.read_text()
    return f"=== {match.name} ===\n{content}"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "save":
        if len(sys.argv) < 3:
            print("Error: save requires a name")
            sys.exit(1)
        name = sys.argv[2]
        content = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else ""
        print(save_memory(name, content))

    elif command == "export":
        if len(sys.argv) < 4:
            print("Error: export requires name and JSON history")
            sys.exit(1)
        name = sys.argv[2]
        history_json = sys.argv[3]
        print(export_conversation(name, history_json))

    elif command == "list":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        print(list_memories(limit))

    elif command == "read":
        if len(sys.argv) < 3:
            print("Error: read requires a search term")
            sys.exit(1)
        query = " ".join(sys.argv[2:])
        print(read_memory(query))

    else:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
