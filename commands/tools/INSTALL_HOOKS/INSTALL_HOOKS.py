#!/usr/bin/env python3
"""
INSTALL_HOOKS - Install Yips git hooks.
"""

import os
import sys
from pathlib import Path

def install():
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    git_hooks_dir = project_root / ".git" / "hooks"
    
    if not git_hooks_dir.exists():
        return "Error: .git directory not found. Are you in a git repository?"
    
    source_hook = project_root / "git_hooks" / "pre-commit"
    target_hook = git_hooks_dir / "pre-commit"
    
    if target_hook.exists():
        print(f"Warning: {target_hook} already exists. Overwriting...")
        
    try:
        # Create a symbolic link or copy
        if os.name == 'nt':
            import shutil
            shutil.copy(source_hook, target_hook)
        else:
            if target_hook.exists():
                target_hook.unlink()
            target_hook.symlink_to(source_hook)
            
        return f"Successfully installed pre-commit hook to {target_hook}"
    except Exception as e:
        return f"Error installing hook: {e}"

def main():
    print(install())

if __name__ == "__main__":
    main()
