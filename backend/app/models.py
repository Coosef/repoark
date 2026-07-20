"""Database models (SQLModel / SQLAlchemy).

Three core tables:
  - Account : a connected GitHub account (username + encrypted token).
  - Job     : one backup configuration (what to back up + schedule).
  - Run     : one execution of a job (history, status, change summary).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    # Stored naive-UTC; the app is timezone-agnostic internally.
    return datetime.utcnow()


class Account(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label: str = ""                      # friendly name shown in the panel
    username: str                        # GitHub login (user) or org name
    token_enc: str                       # Fernet-encrypted PAT
    is_org: bool = False                 # True = back up an organization's repos
    created_at: datetime = Field(default_factory=utcnow)

    # --- Token expiry tracking (from GitHub's token-expiration response header) ---
    token_expires_at: Optional[datetime] = None   # None = never / unknown
    token_warned: bool = False                    # already sent a near-expiry warning

    # --- Backup health (git fsck across the backed-up repos) ---
    health_status: str = ""              # "" unknown | "ok" | "problem"
    health_note: str = ""                # human summary of the last check
    health_checked_at: Optional[datetime] = None


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    account_id: int = Field(foreign_key="account.id")
    name: str = "Backup"

    # --- What to back up (maps to github-backup flags) ---
    repos: bool = True                   # own repositories (code)
    private: bool = True                 # include private repos
    forks: bool = False                  # include forked repos
    wikis: bool = True
    issues: bool = True                  # issues + PRs + comments (JSON)
    starred: bool = True                 # starred repos list (JSON metadata)
    starred_clone: bool = False          # also clone starred repos' code (large!)
    starred_repos: str = ""              # JSON list of full_names to clone ("" = all)
    gists: bool = True
    releases: bool = False               # release metadata + assets (can be large)
    skip_archived: bool = False          # skip archived repositories
    exclude: str = ""                    # repo names to skip (space/comma separated)

    # --- Scheduling ---
    enabled: bool = True
    schedule_kind: str = "interval"      # "interval" | "cron" | "manual"
    interval_minutes: int = 1440         # used when schedule_kind == interval
    cron: str = ""                       # used when schedule_kind == cron

    # --- Change detection ---
    skip_unchanged: bool = True
    last_fingerprint: str = ""           # JSON snapshot of remote state hashes

    # --- Bookkeeping ---
    last_run_at: Optional[datetime] = None
    last_status: str = "never"           # never|running|success|skipped|error
    next_run_at: Optional[datetime] = None
    consecutive_failures: int = 0        # error streak (reset on success/skip)
    created_at: datetime = Field(default_factory=utcnow)


class Settings(SQLModel, table=True):
    """Global app settings (single row, id=1): notifications + retention."""
    id: Optional[int] = Field(default=1, primary_key=True)

    # --- Panel access protection ---
    # Empty = no password (panel open). Otherwise a PBKDF2 hash; the panel
    # requires login. See auth.py.
    panel_password_hash: str = ""

    # --- E-mail (SMTP) notifications ---
    email_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass_enc: str = ""               # encrypted
    smtp_from: str = ""
    smtp_to: str = ""
    smtp_tls: bool = True

    # --- Telegram notifications ---
    telegram_enabled: bool = False
    telegram_token_enc: str = ""          # encrypted bot token
    telegram_chat_id: str = ""

    # --- When to notify ---
    notify_on_success: bool = False
    notify_on_error: bool = True
    notify_on_change: bool = True         # notify on runs that changed something

    # --- Retention ---
    snapshot_retention: int = 0           # keep last N metadata snapshots (0 = all)


class Destination(SQLModel, table=True):
    """An S3-compatible remote backup target (AWS S3, MinIO, Backblaze, …).

    After a successful backup the account's backup tree is rclone-synced here.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "S3"
    type: str = "s3"                     # s3 | smb | local
    enabled: bool = True
    # s3: endpoint/region/bucket/prefix/access_key/secret_key
    # smb: endpoint=host, bucket=share, prefix=subpath, access_key=user, secret_key=pass
    endpoint: str = ""                   # empty = AWS S3; else custom endpoint / SMB host
    region: str = ""
    bucket: str = ""                     # bucket (s3) or share (smb)
    prefix: str = ""                     # optional subpath
    access_key: str = ""                 # access key (s3) or username (smb)
    secret_key_enc: str = ""             # encrypted secret / smb password
    path: str = ""                       # local: mounted directory path (e.g. NAS mount)
    last_sync_at: Optional[datetime] = None
    last_sync_status: str = "never"      # never|running|success|error
    last_sync_log: str = ""


class Run(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id")
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: Optional[datetime] = None
    status: str = "running"              # running|success|skipped|error
    changed: bool = False                # did anything change this run?
    trigger: str = "manual"             # manual|schedule
    summary: str = ""                    # JSON: per-category counts / notes
    snapshot_path: str = ""              # dated metadata snapshot dir, if any
    log: str = ""                        # captured github-backup output / errors

    # --- Measured after the run (for stats + charts) ---
    size_bytes: int = 0                  # total size of current/ backup tree
    repo_count: int = 0
    star_count: int = 0
    gist_count: int = 0
    follower_count: int = 0
