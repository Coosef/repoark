"""Application configuration and filesystem paths.

Everything the app needs to persist lives under DATA_DIR so that a single
Docker volume (or CasaOS bind mount) captures all state: the SQLite database,
the Fernet encryption key, and the actual backups themselves.
"""
from __future__ import annotations

import os
from pathlib import Path

# Root of all persistent state. In Docker this is a mounted volume (/data).
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))

# Where github-backup writes repos + metadata, one subtree per account.
BACKUPS_DIR = DATA_DIR / "backups"

# SQLite database file (accounts, jobs, run history, change-detection state).
DB_PATH = DATA_DIR / "app.db"

# Fernet key used to encrypt GitHub tokens at rest. If not supplied via the
# environment it is generated once and stored in the data volume so tokens
# stay decryptable across container restarts.
SECRET_KEY_ENV = os.environ.get("SECRET_KEY")
SECRET_KEY_FILE = DATA_DIR / "secret.key"

# How often the scheduler re-evaluates jobs whose schedule is an interval.
# Individual jobs decide whether anything actually changed before running.
SCHEDULER_TIMEZONE = os.environ.get("TZ", "UTC")

# GitHub API base (kept configurable for GitHub Enterprise later).
GITHUB_API = os.environ.get("GITHUB_API", "https://api.github.com")


def ensure_dirs() -> None:
    """Create the data directories on startup if they do not exist yet."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
