"""rclone wrapper for syncing backups to S3-compatible destinations.

Secrets are passed via rclone's env-var config (RCLONE_CONFIG_DEST_*) rather
than argv, so they never appear in the process list. A fixed in-memory remote
named "dest" is used per invocation.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from sqlmodel import Session, select

from . import config, crypto
from .models import Account, Destination, utcnow


def _obscure(pw: str) -> str:
    """SMB/other backends expect obscured passwords in config."""
    r = subprocess.run(["rclone", "obscure", pw], capture_output=True, text=True, timeout=15)
    return r.stdout.strip() if r.returncode == 0 else pw


def _env(dest: Destination) -> dict:
    secret = crypto.decrypt(dest.secret_key_enc) if dest.secret_key_enc else ""
    env = dict(os.environ)
    if dest.type == "smb":
        env.update({
            "RCLONE_CONFIG_DEST_TYPE": "smb",
            "RCLONE_CONFIG_DEST_HOST": dest.endpoint,
            "RCLONE_CONFIG_DEST_USER": dest.access_key or "guest",
        })
        if secret:
            env["RCLONE_CONFIG_DEST_PASS"] = _obscure(secret)
    elif dest.type == "local":
        pass  # local backend needs no config
    else:  # s3
        env.update({
            "RCLONE_CONFIG_DEST_TYPE": "s3",
            "RCLONE_CONFIG_DEST_PROVIDER": "AWS" if not dest.endpoint else "Other",
            "RCLONE_CONFIG_DEST_ACCESS_KEY_ID": dest.access_key,
            "RCLONE_CONFIG_DEST_SECRET_ACCESS_KEY": secret,
        })
        if dest.endpoint:
            env["RCLONE_CONFIG_DEST_ENDPOINT"] = dest.endpoint
        if dest.region:
            env["RCLONE_CONFIG_DEST_REGION"] = dest.region
    return env


def _remote(dest: Destination, *parts: str) -> str:
    if dest.type == "local":
        segs = [dest.path.rstrip("/")]
        segs.extend(p.strip("/") for p in parts if p)
        return "/".join(s for s in segs if s)  # a plain filesystem path
    segs = [dest.bucket.strip("/")]           # bucket (s3) or share (smb)
    if dest.prefix.strip("/"):
        segs.append(dest.prefix.strip("/"))
    segs.extend(p.strip("/") for p in parts if p)
    return "dest:" + "/".join(s for s in segs if s)


def _run(args: list[str], env: dict, timeout: int) -> tuple[int, str]:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "rclone zaman aşımına uğradı"
    except FileNotFoundError:
        return 127, "rclone bulunamadı"


def test(dest: Destination) -> tuple[bool, str]:
    """Verify the destination is reachable by listing its root."""
    if dest.type == "local" and not dest.path:
        return False, "Yerel yol gerekli"
    if dest.type in ("s3", "smb") and not dest.bucket:
        return False, "Bucket/paylaşım adı gerekli"
    code, log = _run(
        ["rclone", "lsjson", "--max-depth", "1", _remote(dest)],
        _env(dest), timeout=30,
    )
    return code == 0, log[-4000:]


def _local_file_count(local_dir: str) -> int:
    p = Path(local_dir)
    return sum(1 for x in p.rglob("*") if x.is_file()) if p.is_dir() else 0


def sync(dest: Destination, local_dir: str, account_username: str) -> tuple[int, str]:
    """Incrementally sync an account's backup tree to the destination.

    Two safeguards so a *local* fault can't destroy the offsite copy (rclone
    sync deletes remote files to match local):
      - Refuse to sync an empty local tree onto the remote — an empty/corrupt
        github-backup output must never wipe the remote.
      - `--backup-dir`: anything rclone would delete or overwrite on the remote
        is moved to a sibling `__archive__` folder instead of being lost, so the
        previous state is always recoverable (bounded to one generation)."""
    if _local_file_count(local_dir) == 0:
        return 3, "Yerel yedek boş görünüyor — uzak kopya korundu, senkron atlandı."
    remote = _remote(dest, account_username)
    archive = _remote(dest, "__archive__", account_username)
    code, log = _run(
        ["rclone", "sync", local_dir, remote,
         "--backup-dir", archive,
         "--transfers", "4", "--checkers", "8",
         "--s3-no-check-bucket", "--stats-one-line", "-v"],
        _env(dest), timeout=7200,
    )
    return code, log[-8000:]


def verify(dest: Destination, local_dir: str, account_username: str) -> tuple[bool, str]:
    """After a sync, confirm the remote actually matches local — every local
    file present on the remote with the same size. `--size-only` skips hashing
    so it's metadata-only (no data transfer), and `--one-way` ignores extra
    remote files. Best-effort: a slow/large tree just makes this take longer."""
    remote = _remote(dest, account_username)
    code, log = _run(
        ["rclone", "check", local_dir, remote,
         "--one-way", "--size-only", "--stats-one-line"],
        _env(dest), timeout=1800,
    )
    return code == 0, log[-2000:]


def sync_account(session: Session, dest: Destination, account: Account) -> None:
    """Run one sync and record the result on the destination row."""
    dest.last_sync_status = "running"
    session.add(dest)
    session.commit()
    local = str(config.BACKUPS_DIR / account.username)
    try:
        code, log = sync(dest, local, account.username)
    except Exception as e:
        code, log = 1, f"{type(e).__name__}: {e}"
    if code == 0:
        # Confirm the remote copy really matches — surfaces a silent partial sync.
        try:
            ok, vlog = verify(dest, local, account.username)
            log += "\n[doğrulama] " + ("✓ uzak kopya eşleşiyor" if ok
                                        else "⚠ fark bulundu:\n" + vlog)
        except Exception:
            pass
    dest.last_sync_status = "success" if code == 0 else "error"
    dest.last_sync_at = utcnow()
    dest.last_sync_log = log
    session.add(dest)
    session.commit()


def sync_all_enabled(session: Session, account: Account) -> None:
    """Sync an account's backups to every enabled destination (best-effort)."""
    for dest in session.exec(select(Destination).where(Destination.enabled == True)).all():  # noqa: E712
        try:
            sync_account(session, dest, account)
        except Exception:
            pass
