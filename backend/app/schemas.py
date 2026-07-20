"""Request/response schemas (never expose the encrypted token)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AccountCreate(BaseModel):
    label: str = ""
    token: str
    org: Optional[str] = None            # if set, connect an organization


class AccountUpdate(BaseModel):
    token: str
    label: Optional[str] = None


class AccountRead(BaseModel):
    id: int
    label: str
    username: str
    is_org: bool = False
    created_at: datetime
    token_expires_at: Optional[datetime] = None
    health_status: str = ""
    health_note: str = ""
    health_checked_at: Optional[datetime] = None


class JobBase(BaseModel):
    name: str = "Backup"
    repos: bool = True
    private: bool = True
    forks: bool = False
    wikis: bool = True
    issues: bool = True
    starred: bool = True
    starred_clone: bool = False
    starred_repos: str = ""
    gists: bool = True
    releases: bool = False
    skip_archived: bool = False
    exclude: str = ""
    enabled: bool = True
    schedule_kind: str = "interval"
    interval_minutes: int = 1440
    cron: str = ""
    skip_unchanged: bool = True


class JobCreate(JobBase):
    account_id: int


class JobUpdate(JobBase):
    pass


class JobRead(JobBase):
    id: int
    account_id: int
    last_run_at: Optional[datetime] = None
    last_status: str
    next_run_at: Optional[datetime] = None
    created_at: datetime


class RestoreBody(BaseModel):
    new_name: str = ""       # target repo name (defaults to the backed-up name)
    private: bool = True


class LoginBody(BaseModel):
    password: str = ""


class PasswordBody(BaseModel):
    current: str = ""        # required to change an existing password (unless logged in)
    new: str = ""            # empty = remove protection


class SettingsRead(BaseModel):
    email_enabled: bool
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_from: str
    smtp_to: str
    smtp_tls: bool
    smtp_pass_set: bool
    telegram_enabled: bool
    telegram_chat_id: str
    telegram_token_set: bool
    notify_on_success: bool
    notify_on_error: bool
    notify_on_change: bool
    snapshot_retention: int


class SettingsUpdate(BaseModel):
    email_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_from: str = ""
    smtp_to: str = ""
    smtp_tls: bool = True
    smtp_pass: Optional[str] = None        # only stored if non-empty
    telegram_enabled: bool = False
    telegram_chat_id: str = ""
    telegram_token: Optional[str] = None   # only stored if non-empty
    notify_on_success: bool = False
    notify_on_error: bool = True
    notify_on_change: bool = True
    snapshot_retention: int = 0


class DestinationBase(BaseModel):
    name: str = "S3"
    type: str = "s3"
    enabled: bool = True
    endpoint: str = ""
    region: str = ""
    bucket: str = ""
    prefix: str = ""
    access_key: str = ""
    path: str = ""


class DestinationCreate(DestinationBase):
    secret_key: str = ""


class DestinationUpdate(DestinationBase):
    secret_key: Optional[str] = None       # only stored if provided


class DestinationRead(DestinationBase):
    id: int
    secret_key_set: bool
    last_sync_at: Optional[datetime] = None
    last_sync_status: str
    last_sync_log: str


class RunRead(BaseModel):
    id: int
    job_id: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    status: str
    changed: bool
    trigger: str
    summary: str
    snapshot_path: str
    log: str
    # Optional because rows created before these columns existed hold NULL
    # (the auto-migration adds columns nullable); the panel treats None as 0.
    size_bytes: Optional[int] = 0
    repo_count: Optional[int] = 0
    star_count: Optional[int] = 0
    gist_count: Optional[int] = 0
    follower_count: Optional[int] = 0
