"""
Information utilities for Yips CLI.

Provides functions for retrieving user info, activity history, and display names.
"""

import re

from cli.config import BASE_DIR, MEMORIES_DIR


def get_username() -> str:
    """Get user's preferred name from HUMAN.md, fallback to Katherine."""
    try:
        human_file = BASE_DIR / "author" / "HUMAN.md"
        if human_file.exists():
            content = human_file.read_text()
            # Look for "Preferred name/nickname" field
            for line in content.split('\n'):
                if line.startswith('**Preferred name/nickname**'):
                    # Extract content after the colon
                    match = re.search(r'\*\*Preferred name/nickname\*\*:\s*(.+?)(?:\n|$)', content)
                    if match:
                        name = match.group(1).strip()
                        if name and not name.startswith('<!--'):
                            return name
            # Fallback to Name field if preferred name is empty
            match = re.search(r'\*\*Name\*\*:\s*(.+?)(?:\n|$)', content)
            if match:
                return match.group(1).strip()
    except Exception:
        pass
    return "Katherine"


def get_recent_activity(limit: int = 3) -> list[str]:
    """Get recent activity from memories directory."""
    try:
        if not MEMORIES_DIR.exists():
            return ["No recent activity"]

        memory_files = sorted(
            MEMORIES_DIR.glob("*.md"),
            key=lambda f: f.stat().st_mtime,
            reverse=True
        )[:limit]

        if not memory_files:
            return ["No recent activity"]

        activities: list[str] = []
        for f in memory_files:
            # Parse filename format: 2026-01-31_03-56-21_file_editing_and_logging.md
            name = f.stem  # Remove .md extension
            parts = name.split('_', 2)

            if len(parts) >= 3:
                date_part = parts[0]  # YYYY-MM-DD
                # Rest is the title (parts[2] onwards, join with _)
                title = '_'.join(parts[2:])
                # Convert underscores to spaces and title case
                title = title.replace('_', ' ').title()
            else:
                # Fallback for old format
                date_part = f.stat().st_mtime
                title = name

            activities.append(f"{date_part}: {title}")

        return activities if activities else ["No recent activity"]
    except Exception:
        return ["No recent activity"]


def get_friendly_backend_name(backend_name: str) -> str:
    """Convert internal backend name to display-friendly name."""
    mapping = {
        "claude": "Claude Pro",
        "lmstudio": "LM Studio",
    }
    return mapping.get(backend_name, backend_name)


def get_friendly_model_name(model_name: str) -> str:
    """Convert internal model name to display-friendly name."""
    mapping = {
        "haiku": "4.5 Haiku",
        "sonnet": "4.5 Sonnet",
        "opus": "4.5 Opus",
        "lmstudio-community/gpt-oss-20b-GGUF": "gpt-oss",
    }
    return mapping.get(model_name, model_name)
