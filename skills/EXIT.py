#!/usr/bin/env python3
"""
EXIT - Graceful shutdown skill for Yips

This skill triggers the agent's graceful exit sequence.
"""

import sys

def main():
    print("Initiating shutdown...")
    print("::YIPS_COMMAND::EXIT::")

if __name__ == "__main__":
    main()
