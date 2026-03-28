"""Tests for recent activity and session list parsing."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from cli.info_utils import get_recent_activity_items, get_session_list


def test_recent_activity_builds_discord_branded_prefix(tmp_path: Path):
    path = tmp_path / "2026-03-27_12-00-00_discord_yipsdev_general_hello_yips.md"
    path.write_text(
        "# Session Memory\n\n"
        "**Created**: 2026-03-27 12:00:00\n"
        "**Type**: Ongoing Session\n"
        "**Source**: Discord (#general)\n"
        "**Platform**: Discord\n"
        "**Server**: yips.dev\n"
        "**Channel**: general\n"
        "**ChannelId**: 123\n\n"
        "## Conversation\n\n"
        "**Alice**: hello\n",
        encoding="utf-8",
    )

    with patch("cli.info_utils.MEMORIES_DIR", tmp_path):
        items = get_recent_activity_items()

    assert len(items) == 1
    assert items[0].prefix == "Discord\\yips.dev\\#general | "
    assert items[0].title == "Hello Yips"
    assert items[0].prefix_color == "#5865F2"


def test_recent_activity_legacy_discord_uses_unknown_server_fallback(tmp_path: Path):
    path = tmp_path / "2026-03-27_12-00-00_discord_general_hello_yips.md"
    path.write_text(
        "# Session Memory\n\n"
        "**Created**: 2026-03-27 12:00:00\n"
        "**Type**: Ongoing Session\n"
        "**Source**: Discord (#general)\n\n"
        "## Conversation\n\n"
        "**Alice**: hello\n",
        encoding="utf-8",
    )

    with patch("cli.info_utils.MEMORIES_DIR", tmp_path):
        items = get_recent_activity_items()

    assert items[0].prefix == "Discord\\Unknown Server\\#general | "


def test_session_list_keeps_structured_display_segments(tmp_path: Path):
    path = tmp_path / "2026-03-27_12-00-00_discord_yipsdev_general_hello_yips.md"
    path.write_text(
        "# Session Memory\n\n"
        "**Created**: 2026-03-27 12:00:00\n"
        "**Type**: Ongoing Session\n"
        "**Source**: Discord (#general)\n"
        "**Platform**: Discord\n"
        "**Server**: yips.dev\n"
        "**Channel**: general\n"
        "**ChannelId**: 123\n\n"
        "## Conversation\n\n"
        "**Alice**: hello\n",
        encoding="utf-8",
    )

    with patch("cli.info_utils.MEMORIES_DIR", tmp_path):
        sessions = get_session_list()

    assert sessions[0]["display_prefix"] == "Discord\\yips.dev\\#general | "
    assert sessions[0]["display_title"] == "Hello Yips"
    assert sessions[0]["prefix_color"] == "#5865F2"
    assert "Discord\\yips.dev\\#general | Hello Yips" in sessions[0]["display_plain"]
