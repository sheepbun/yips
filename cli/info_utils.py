"""
Information utilities for Yips CLI.

Provides functions for retrieving user info, activity history, and display names.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from functools import lru_cache

from cli.config import BASE_DIR, MEMORIES_DIR
from cli.gateway.discord_session import (
    DISCORD_PREFIX_COLOR,
    build_display_label,
    extract_display_parts,
    infer_session_slug_from_filename,
)


@dataclass(frozen=True)
class ActivityItem:
    display_time: str
    prefix: str
    title: str
    prefix_color: str | None
    path: Path


def _parse_memory_timestamp(path: Path) -> datetime:
    name = path.stem
    parts = name.split("_", 2)
    if len(parts) >= 3:
        date_part = parts[0]
        time_part = parts[1]
        try:
            if "-" in date_part:
                return datetime.strptime(
                    f"{date_part} {time_part.replace('-', ':')}",
                    "%Y-%m-%d %H:%M:%S",
                )
            return datetime.strptime(f"{date_part} {time_part}", "%Y%m%d %H%M%S")
        except ValueError:
            pass
    return datetime.fromtimestamp(path.stat().st_mtime)


def _format_display_time(dt: datetime) -> str:
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

    date_str = f"{dt.year}-{dt.month}-{dt.day}"
    time_str = f"{display_hour:>2}:{dt.strftime('%M')} {am_pm}"
    return f"{date_str} @ {time_str}"


def _read_session_headers(path: Path) -> dict[str, str]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return {}

    headers: dict[str, str] = {}
    for line in text.splitlines():
        if line == "## Conversation":
            break
        match = re.match(r"\*\*(.+?)\*\*:\s*(.*)", line.strip())
        if match:
            headers[match.group(1).strip()] = match.group(2).strip()
    return headers


def _display_title_from_path(path: Path, channel_name: str | None = None) -> str:
    return infer_session_slug_from_filename(path, channel_name=channel_name).replace("_", " ").title()


def _build_activity_item(path: Path, dt: datetime) -> ActivityItem:
    headers = _read_session_headers(path)
    display_time = _format_display_time(dt)
    platform = headers.get("Platform")

    if platform == "Discord" or path.stem.split("_", 2)[-1].startswith("discord_"):
        server_name = headers.get("Server")
        channel_name = headers.get("Channel")

        if not channel_name:
            source = headers.get("Source", "")
            guild_match = re.search(r"\(#(.+?)\)", source)
            dm_match = re.search(r"\((?!#)(.+?)\)", source)
            if guild_match:
                channel_name = guild_match.group(1)
            elif dm_match:
                channel_name = dm_match.group(1)

        if not server_name:
            server_name = "Unknown Server"

        session_name = _display_title_from_path(
            path,
            channel_name=channel_name if "Server" not in headers else None,
        )
        display_label = build_display_label(
            "Discord",
            server_name,
            channel_name or "unknown",
            session_name,
        )
        prefix, title = extract_display_parts(display_label)
        return ActivityItem(
            display_time=display_time,
            prefix=prefix,
            title=title,
            prefix_color=DISCORD_PREFIX_COLOR,
            path=path,
        )

    return ActivityItem(
        display_time=display_time,
        prefix="",
        title=_display_title_from_path(path),
        prefix_color=None,
        path=path,
    )


@lru_cache(maxsize=1)
def get_username() -> str:
    """Get user's preferred name from HUMAN.md, fallback to Katherine."""
    try:
        human_file = BASE_DIR / "author" / "HUMAN.md"
        if human_file.exists():
            content = human_file.read_text()
            for line in content.split("\n"):
                if line.startswith("**Preferred name/nickname**"):
                    match = re.search(r"\*\*Preferred name/nickname\*\*:\s*(.+?)(?:\n|$)", content)
                    if match:
                        name = match.group(1).strip()
                        if name and not name.startswith("<!--"):
                            return name
            match = re.search(r"\*\*Name\*\*:\s*(.+?)(?:\n|$)", content)
            if match:
                return match.group(1).strip()
    except Exception:
        pass
    return "Katherine"


def get_display_directory() -> str:
    """Get the current working directory to display in title box with tilde notation."""
    import os

    user_cwd = os.environ.get("YIPS_USER_CWD")
    cwd = Path(user_cwd) if user_cwd else Path.cwd()
    home_path = Path.home()

    try:
        relative = cwd.relative_to(home_path)
        return f"~/{relative}"
    except ValueError:
        return str(cwd)


def get_recent_activity_items(limit: int = 5) -> list[ActivityItem]:
    try:
        if not MEMORIES_DIR.exists():
            return []

        dated_files = [(_parse_memory_timestamp(path), path) for path in MEMORIES_DIR.glob("*.md")]
        dated_files.sort(key=lambda item: item[0], reverse=True)
        return [_build_activity_item(path, dt) for dt, path in dated_files[:limit]]
    except Exception:
        return []


def get_recent_activity(limit: int = 5) -> list[str]:
    items = get_recent_activity_items(limit=limit)
    if not items:
        return ["No recent activity"]
    return [f"{item.display_time}: {item.prefix}{item.title}" for item in items]


def get_session_list() -> list[dict[str, Any]]:
    """Get session files with structured display segments and plain compatibility text."""
    try:
        if not MEMORIES_DIR.exists():
            return []

        dated_files = [(_parse_memory_timestamp(path), path) for path in MEMORIES_DIR.glob("*.md")]
        dated_files.sort(key=lambda item: item[0], reverse=True)

        sessions: list[dict[str, Any]] = []
        for dt, path in dated_files:
            item = _build_activity_item(path, dt)
            display_plain = f"{item.display_time}: {item.prefix}{item.title}"
            sessions.append(
                {
                    "path": path,
                    "timestamp": item.display_time,
                    "display_prefix": item.prefix,
                    "display_title": item.title,
                    "prefix_color": item.prefix_color,
                    "display_plain": display_plain,
                    "display": display_plain,
                }
            )
        return sessions
    except Exception:
        return []


def get_friendly_backend_name(backend_name: str) -> str:
    """Convert internal backend name to display-friendly name."""
    mapping = {
        "claude": "Claude Pro",
        "llamacpp": "llama.cpp",
    }
    return mapping.get(backend_name, backend_name)


def get_friendly_model_name(model_name: str | None) -> str:
    """Convert internal model name to display-friendly name."""
    if not model_name:
        return "Default"

    from cli.config import load_config

    config = load_config()
    nicknames = config.get("nicknames", {})
    if model_name in nicknames:
        return nicknames[model_name]

    sep = "/" if "/" in model_name else ("\\" if "\\" in model_name else None)
    if sep:
        parts = model_name.split(sep)
        pure_name = parts[-2] if len(parts) >= 2 else parts[-1]
        if pure_name.endswith(".gguf"):
            pure_name = pure_name[:-5]
    else:
        pure_name = model_name[:-5] if model_name.endswith(".gguf") else model_name

    if pure_name in nicknames:
        return nicknames[pure_name]

    mapping = {
        "haiku": "4.5 Haiku",
        "sonnet": "4.5 Sonnet",
        "opus": "4.5 Opus",
        "google/gemma-3-12b": "gemma-3",
        "openai/gpt-oss-20b": "gpt-oss",
        "qwen/qwen3-4b-thinking": "qwen-3",
        "Qwen3-4B-Thinking-2507-Q4_K_M": "qwen-3",
        "gemma-3-12b-it-Q4_K_M": "gemma-3",
    }
    return mapping.get(pure_name, pure_name)


def set_model_nickname(model_target: str, nickname: str) -> None:
    """Set a custom nickname for a model and save to config."""
    from cli.config import load_config, save_config

    config = load_config()
    nicknames = config.get("nicknames", {})
    nicknames[model_target] = nickname
    config["nicknames"] = nicknames
    save_config(config)
