"""
Information utilities for Yips CLI.

Provides functions for retrieving user info, activity history, and display names.
"""

import re
from datetime import datetime

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


def get_display_directory() -> str:
    """Get the current working directory to display in title box with tilde notation.

    Returns the directory where yips was launched from (from YIPS_USER_CWD env var),
    or falls back to current working directory. Uses ~ notation if under home directory.
    """
    import os
    from pathlib import Path

    # Check for the user's original working directory from launcher
    user_cwd = os.environ.get('YIPS_USER_CWD')
    if user_cwd:
        cwd = Path(user_cwd)
    else:
        # Fallback to current working directory
        cwd = Path.cwd()

    home_path = Path.home()

    # Check if cwd is under home directory
    try:
        # relative_to() will raise ValueError if not a subpath
        relative = cwd.relative_to(home_path)
        # Return with tilde notation
        return f"~/{relative}"
    except ValueError:
        # Not under home directory, return absolute path
        return str(cwd)


def get_recent_activity(limit: int = 5) -> list[str]:
    """Get recent activity from memories directory.

    Supports both filename formats:
    - New format: 2026-01-31_03-56-21_title.md (YYYY-MM-DD_HH-MM-SS_title)
    - Old format: 20260131_023835_title.md (YYYYMMDD_HHMMSS_title)

    Returns list of formatted strings: "YYYY-MM-DD @ HH:MM XM: Title"
    """
    try:
        if not MEMORIES_DIR.exists():
            return ["No recent activity"]

        # Build list of (datetime, filepath) tuples by parsing filenames
        dated_files: list[tuple[datetime, any]] = []
        for f in MEMORIES_DIR.glob("*.md"):
            try:
                name = f.stem  # Remove .md extension
                parts = name.split('_', 2)

                if len(parts) >= 3:
                    date_part = parts[0]
                    time_part = parts[1]

                    # Detect format by checking for hyphens in date part
                    if '-' in date_part:
                        # New format: YYYY-MM-DD_HH-MM-SS
                        try:
                            dt_str = f"{date_part} {time_part.replace('-', ':')}"
                            dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
                            dated_files.append((dt, f))
                        except ValueError:
                            # Fallback to st_mtime if parsing fails
                            dt = datetime.fromtimestamp(f.stat().st_mtime)
                            dated_files.append((dt, f))
                    else:
                        # Old format: YYYYMMDD_HHMMSS
                        try:
                            dt_str = f"{date_part} {time_part}"
                            dt = datetime.strptime(dt_str, '%Y%m%d %H%M%S')
                            dated_files.append((dt, f))
                        except ValueError:
                            # Fallback to st_mtime if parsing fails
                            dt = datetime.fromtimestamp(f.stat().st_mtime)
                            dated_files.append((dt, f))
                else:
                    # Fallback for malformed filenames
                    dt = datetime.fromtimestamp(f.stat().st_mtime)
                    dated_files.append((dt, f))
            except Exception:
                # Skip files that cause exceptions
                continue

        if not dated_files:
            return ["No recent activity"]

        # Sort by datetime descending (most recent first)
        dated_files.sort(key=lambda x: x[0], reverse=True)
        memory_files = [f for _, f in dated_files[:limit]]

        activities: list[str] = []
        for f in memory_files:
            try:
                name = f.stem  # Remove .md extension
                parts = name.split('_', 2)

                if len(parts) >= 3:
                    date_part = parts[0]
                    time_part = parts[1]
                    title = '_'.join(parts[2:])
                    title = title.replace('_', ' ').title()

                    # Detect format by checking for hyphens in date part
                    if '-' in date_part:
                        # New format: YYYY-MM-DD_HH-MM-SS
                        try:
                            dt = datetime.strptime(date_part, '%Y-%m-%d')
                            # Extract hour and minute from HH-MM-SS format
                            time_parts = time_part.split('-')
                            if len(time_parts) >= 2:
                                hour_int = int(time_parts[0])
                                minute = time_parts[1]
                                # Convert to 12-hour format with AM/PM
                                if hour_int == 0:
                                    display_hour = 12
                                    am_pm = "AM"
                                elif hour_int < 12:
                                    display_hour = hour_int
                                    am_pm = "AM"
                                elif hour_int == 12:
                                    display_hour = 12
                                    am_pm = "PM"
                                else:
                                    display_hour = hour_int - 12
                                    am_pm = "PM"
                                display = f"{dt.strftime('%Y-%-m-%-d')} @ {display_hour}:{minute} {am_pm}: {title}"
                            else:
                                display = f"{dt.strftime('%Y-%-m-%-d')}: {title}"
                        except (ValueError, IndexError):
                            display = f"{date_part}: {title}"
                    else:
                        # Old format: YYYYMMDD_HHMMSS
                        try:
                            dt = datetime.strptime(date_part, '%Y%m%d')
                            # Extract hour and minute from HHMMSS (first 4 chars: HHMM)
                            if len(time_part) >= 4:
                                hour_int = int(time_part[:2])
                                minute = time_part[2:4]
                                # Convert to 12-hour format with AM/PM
                                if hour_int == 0:
                                    display_hour = 12
                                    am_pm = "AM"
                                elif hour_int < 12:
                                    display_hour = hour_int
                                    am_pm = "AM"
                                elif hour_int == 12:
                                    display_hour = 12
                                    am_pm = "PM"
                                else:
                                    display_hour = hour_int - 12
                                    am_pm = "PM"
                                display = f"{dt.strftime('%Y-%-m-%-d')} @ {display_hour}:{minute} {am_pm}: {title}"
                            else:
                                display = f"{dt.strftime('%Y-%-m-%-d')}: {title}"
                        except (ValueError, IndexError):
                            display = f"{date_part}: {title}"
                else:
                    # Fallback for malformed filenames
                    dt = datetime.fromtimestamp(f.stat().st_mtime)
                    hour_int = dt.hour
                    if hour_int == 0:
                        display_hour = 12
                        am_pm = "AM"
                    elif hour_int < 12:
                        display_hour = hour_int
                        am_pm = "AM"
                    elif hour_int == 12:
                        display_hour = 12
                        am_pm = "PM"
                    else:
                        display_hour = hour_int - 12
                        am_pm = "PM"
                    display = f"{dt.strftime('%Y-%-m-%-d')} @ {display_hour}:{dt.strftime('%M')} {am_pm}: {name}"

                activities.append(display)
            except Exception:
                # If parsing fails for a specific file, skip it
                continue

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
