#!/usr/bin/env python3
"""
REPROMPT - Allow Yips to reprompt itself for multi-step reasoning

Usage:
    /reprompt <message>
    {INVOKE_SKILL:REPROMPT:<message>}

This skill enables autonomous multi-step reasoning by allowing the AI to
send follow-up prompts to itself. Useful for:
- Breaking down complex tasks into steps
- Iterating on solutions
- Self-correction and refinement
- Continuing interrupted work

The message will be processed as a new user input, allowing the AI to
respond to its own requests and chain multiple reasoning steps together.
"""

import sys


def main():
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    if not args:
        print("Usage: /reprompt <message>")
        print("       {INVOKE_SKILL:REPROMPT:<message>}")
        print()
        print("Examples:")
        print("  /reprompt Now analyze the results and suggest improvements")
        print("  /reprompt Continue with the next step")
        print("  {INVOKE_SKILL:REPROMPT:Now implement the changes we discussed}")
        return

    # Join all arguments as the reprompt message
    message = " ".join(args)

    # Emit the control command that main.py will intercept
    print(f"::YIPS_COMMAND::REPROMPT::{message}")


if __name__ == "__main__":
    main()
