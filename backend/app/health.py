"""Backup integrity verification via `git fsck` on each bare mirror.

A backup is only useful if the stored git objects are intact. After a backup
(and on demand) we run a fast connectivity-only fsck across every repo and
record a health status on the account so the panel can show a trustworthy
"verified" badge — or flag exactly which repo is damaged.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from sqlmodel import Session

from . import config
from .models import Account, utcnow


def _repos_root(username: str) -> Path:
    return config.BACKUPS_DIR / username / "current" / "repositories"


def check_account(username: str) -> dict:
    """Run git fsck on every backed-up repo. Returns a summary dict."""
    root = _repos_root(username)
    problems: list[dict] = []
    total = 0
    if root.is_dir():
        for d in sorted(root.iterdir()):
            gd = d / "repository"
            if not gd.is_dir():
                continue
            total += 1
            try:
                r = subprocess.run(
                    ["git", f"--git-dir={gd}", "fsck",
                     "--connectivity-only", "--no-progress", "--no-dangling"],
                    capture_output=True, timeout=180,
                )
                if r.returncode != 0:
                    err = r.stderr.decode(errors="replace").strip()
                    problems.append({"repo": d.name, "error": err[:300] or "fsck failed"})
            except Exception as e:  # timeout / missing git — treat as a problem
                problems.append({"repo": d.name, "error": str(e)[:300]})
    return {
        "ok": not problems,
        "total": total,
        "ok_count": total - len(problems),
        "problems": problems,
    }


def update_account_health(session: Session, account: Account) -> dict:
    """Run the check and persist the result on the account row."""
    result = check_account(account.username)
    account.health_status = "ok" if result["ok"] else "problem"
    if result["total"] == 0:
        account.health_note = "Henüz yedeklenmiş repo yok"
    elif result["ok"]:
        account.health_note = f"{result['total']} repo doğrulandı"
    else:
        names = ", ".join(p["repo"] for p in result["problems"][:5])
        account.health_note = f"{len(result['problems'])}/{result['total']} repo hatalı: {names}"
    account.health_checked_at = utcnow()
    session.add(account)
    session.commit()
    return result
