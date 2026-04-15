"""Helpers for spawning subprocesses from the Yips binary.

The Linux PyInstaller onefile build extracts bundled shared libraries into
``sys._MEIPASS`` and prepends that directory to ``LD_LIBRARY_PATH``. Child
processes inherit this env, so system binaries (notably ``/bin/sh``) try to
load the bundled ``libreadline.so`` and crash with
``undefined symbol: rl_print_keybinding``.

PyInstaller saves the caller's original ``LD_LIBRARY_PATH`` under
``LD_LIBRARY_PATH_ORIG``. :func:`clean_subprocess_env` restores it so
subprocesses run against the user's system libraries.
"""

from __future__ import annotations

import os
import subprocess
import sys


def clear_screen() -> None:
    """Clear the terminal without spawning a shell on POSIX.

    On Linux the frozen binary's env poisons ``/bin/sh`` via ``LD_LIBRARY_PATH``
    (see :func:`clean_subprocess_env`). Writing the ANSI clear sequence
    directly avoids the shell entirely. Windows still needs ``cls``.
    """
    if os.name == "nt":
        subprocess.run("cls", shell=True)
    else:
        sys.stdout.write("\033[2J\033[H")
        sys.stdout.flush()


def clean_subprocess_env() -> dict[str, str]:
    """Return a copy of ``os.environ`` safe to hand to child processes."""
    env = os.environ.copy()

    if not (getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")):
        return env

    for var in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        orig = env.pop(f"{var}_ORIG", None)
        if orig is not None:
            env[var] = orig
        else:
            env.pop(var, None)

    return env
