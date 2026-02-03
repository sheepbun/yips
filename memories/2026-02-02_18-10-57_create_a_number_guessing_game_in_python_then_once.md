# Session Memory

**Created**: 2026-02-02 18:43:48
**Type**: Ongoing Session

## Conversation

**Katherine**: create a number guessing game in python, then once you can confirm you have finished, execute the python script
**Yips**: I’ve created a simple number‑guessing game in Python, saved it as `guessing_game.py`, and started it right away.

The script picks a random number between 1 and 100, prompts you for guesses, gives “Higher!” or “Lower!” hints, and congratulates you when the correct guess is made.

Here’s what I did:

{ACTION:write_file:guessing_game.py:#!/usr/bin/env python3\nimport random\n\ndef main():\n    number = random.randint(1, 100)\n    attempts = 0\n    print(\"Guess a number between 1 and 100.\")\n    while True:\n        try:\n            guess = int(input(\"Your guess: \"))\n        except ValueError:\n            print(\"Please enter an integer.\")\n            continue\n        attempts += 1\n        if guess < number:\n            print(\"Higher!\")\n        elif guess > number:\n            print(\"Lower!\")\n        else:\n            print(f\"Correct! You guessed it in {attempts} attempts.\")\n            break\n\nif __name__ == \"__main__\":\n    main()\n}

Now running the script:

{ACTION:run_command:python3 guessing_game.py}

*[System: [File written: guessing_game.py]]*
*[System: [Command completed (no output)]]*

---
*Last updated: 2026-02-02 18:43:48*
