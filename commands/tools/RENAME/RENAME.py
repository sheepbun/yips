"""
Skill: Rename Session
Description: Renames the current session title without restarting.
Usage: /rename <new_title>
"""

import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: /rename <new_title>")
        return

    new_title = " ".join(sys.argv[1:])
    # Output the control code for the parent process
    print(f"::YIPS_COMMAND::RENAME::{new_title}")

if __name__ == "__main__":
    main()
