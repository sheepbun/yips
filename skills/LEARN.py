#!/usr/bin/env python3
"""
LEARN - Skill creation helper for Yips

Usage:
    /learn <skill_name> <description>

This skill outputs instructions for the LLM to create a new skill script.
The LLM will then use {ACTION:write_file:...} to create the skill.
"""

import sys
from pathlib import Path

from cli.root import PROJECT_ROOT

SKILLS_DIR = PROJECT_ROOT / "skills"


def main():
    if len(sys.argv) < 3:
        print("Usage: /learn <skill_name> <description>")
        print("Example: /learn WEATHER Get current weather for a location")
        sys.exit(1)

    skill_name = sys.argv[1].upper()
    description = " ".join(sys.argv[2:])

    # Validate skill name
    if not skill_name.isalnum():
        print(f"Error: Skill name must be alphanumeric, got: {skill_name}")
        sys.exit(1)

    skill_path = SKILLS_DIR / f"{skill_name}.py"
    if skill_path.exists():
        print(f"Error: Skill already exists: {skill_path}")
        sys.exit(1)

    # Output instructions for the LLM
    template = f'''I need you to create a new skill for me.

**Skill Name**: {skill_name}
**Description**: {description}
**File Path**: {skill_path}

Please write a Python script following this template:

```python
#!/usr/bin/env python3
"""
{skill_name} - {description}

Usage:
    /{skill_name.lower()} <args>
"""

import sys
from pathlib import Path


def main():
    # Parse arguments
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    # TODO: Implement the skill logic here
    # Print output that will be displayed to the user
    print("Skill output here")


if __name__ == "__main__":
    main()
```

Use {{ACTION:write_file:{skill_path}:<your code>}} to create the file.
Make the skill functional based on the description provided.'''

    print(template)


if __name__ == "__main__":
    main()
