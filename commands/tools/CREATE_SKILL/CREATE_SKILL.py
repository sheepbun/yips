#!/usr/bin/env python3
"""
CREATE_SKILL - Tool for Yips to create new skills.

Usage:
    /create_skill <name> <content>
"""

import sys
import os
from pathlib import Path

def create_skill(name, content):
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    
    # Check for temporary sandbox first (per roadmap)
    sandbox_dir = Path("/tmp/yips")
    sandbox_dir.mkdir(parents=True, exist_ok=True)
    
    # We'll allow the agent to specify if they want to go straight to production or use sandbox
    # For now, let's create it in commands/tools/ if it's "finalized"
    
    skill_dir = project_root / "commands" / "tools" / name.upper()
    skill_dir.mkdir(parents=True, exist_ok=True)
    
    skill_file = skill_dir / f"{name.upper()}.py"
    
    if skill_file.exists():
        return f"Error: Skill {name} already exists."
        
    try:
        skill_file.write_text(content)
        skill_file.chmod(0o755) # Make executable
        return f"Skill {name} created successfully at {skill_file}"
    except Exception as e:
        return f"Error creating skill: {e}"

def main():
    if len(sys.argv) < 3:
        print("Usage: /create_skill <name> <content>")
        sys.exit(1)
        
    name = sys.argv[1]
    content = " ".join(sys.argv[2:])
    
    print(create_skill(name, content))

if __name__ == "__main__":
    main()
