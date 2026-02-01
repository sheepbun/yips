#!/usr/bin/env python3
"""
EXIT - Graceful shutdown skill for Yips

This skill is invoked when Yips exits. It:
1. Saves the current conversation to memory using MEMORIZE
2. Provides a farewell message

Usage (called by AGENT.py):
    python EXIT.py '<json_conversation_history>'
"""

import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path

from cli.root import PROJECT_ROOT

SKILLS_DIR = PROJECT_ROOT / "skills"
MEMORIZE_SKILL = SKILLS_DIR / "MEMORIZE.py"


def generate_session_name() -> str:
    """Generate a fallback name for this session."""
    return f"session_{datetime.now().strftime('%Y%m%d_%H%M')}"


def save_conversation(history_json: str, session_name: str = None) -> str:
    """Save the conversation using MEMORIZE skill."""
    if not MEMORIZE_SKILL.exists():
        return "Warning: MEMORIZE skill not found, conversation not saved."

    if not session_name:
        session_name = generate_session_name()

    try:
        result = subprocess.run(
            [sys.executable, str(MEMORIZE_SKILL), "export", session_name, history_json],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return result.stdout.strip()
        else:
            return f"Warning: Failed to save session - {result.stderr}"

    except subprocess.TimeoutExpired:
        return "Warning: Save operation timed out."
    except Exception as e:
        return f"Warning: Error saving session - {e}"


def main():
    """Main entry point for EXIT skill."""
    output_lines = []

    # Check if conversation history was provided
    if len(sys.argv) > 1:
        history_json = sys.argv[1]
        session_name = sys.argv[2] if len(sys.argv) > 2 else None

        # Validate it's actual JSON with content
        try:
            history = json.loads(history_json)
            if history and len(history) > 0:
                save_result = save_conversation(history_json, session_name)
                output_lines.append(save_result)
            else:
                output_lines.append("No conversation to save.")
        except json.JSONDecodeError:
            output_lines.append("Warning: Invalid conversation data, not saved.")
    else:
        output_lines.append("No conversation history provided.")

    # Print results
    for line in output_lines:
        print(line)


if __name__ == "__main__":
    main()
