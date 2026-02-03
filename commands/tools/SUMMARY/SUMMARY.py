#!/usr/bin/env python3
"""
SUMMARY - Daily summary and blocker tracking for Yips.

Usage:
    /summary <work_done> [blockers]
"""

import sys
from datetime import datetime
from pathlib import Path
from cli.config import DOT_YIPS_DIR

SUMMARIES_DIR = DOT_YIPS_DIR / "summaries"

def save_summary(work_done, blockers=None):
    SUMMARIES_DIR.mkdir(parents=True, exist_ok=True)
    
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"{date_str}_summary.md"
    filepath = SUMMARIES_DIR / filename
    
    content = f"""# Daily Summary: {date_str}

## Work Done
{work_done}

## Blockers
{blockers if blockers else "None"}

---
*Created at {datetime.now().strftime("%H:%M:%S")}*
"""
    
    # If file exists, append to it or overwrite? Roadmap says "daily summaries", 
    # so appending might be better if multiple tasks are done in a day.
    if filepath.exists():
        existing = filepath.read_text()
        # Find where the last entry ends or just append
        new_content = existing + f"\n\n### Update at {datetime.now().strftime('%H:%M:%S')}\n\n**Work Done**: {work_done}\n**Blockers**: {blockers if blockers else 'None'}\n"
        filepath.write_text(new_content)
    else:
        filepath.write_text(content)
        
    return f"Daily summary saved to {filepath}"

def main():
    if len(sys.argv) < 2:
        print("Usage: /summary <work_done> [blockers]")
        sys.exit(1)
        
    work_done = sys.argv[1]
    blockers = sys.argv[2] if len(sys.argv) > 2 else "None"
    
    print(save_summary(work_done, blockers))

if __name__ == "__main__":
    main()
