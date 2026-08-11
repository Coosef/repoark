"""Backup integrity verification via `git fsck` on each bare mirror.

A backup is only useful if the stored git objects are intact. After a backup
(and on demand) we run a fast connectivity-only fsck across every repo and
record a health status on the account so the panel can show a trustworthy
"verified" badge — or flag exactly which repo is damaged.
"""
from __future__ import annotations

import os
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

from sqlmodel import Session

from . import config
from .models import Account, utcnow


def _repos_root(username: str) -> Path:
    return config.BACKUPS_DIR / username / "current" / "repositories"


def restore_drill(username: str, sample: int = 3) -> dict:
    """A real restore test, stronger than fsck: actually clone a random sample
    of the backed-up mirrors into a throwaway working tree and confirm the tip
    checks out — i.e. the backup can genuinely be restored, not just that its
    objects are reachable. `--no-local` forces a real object transfer (not a
    hardlink), `--depth 1` keeps it fast."""
    root = _repos_root(username)
    mirrors: list[tuple[str, Path]] = []
    if root.is_dir():
        for d in sorted(root.iterdir()):
            gd = d / "repository"
            if gd.is_dir():
                mirrors.append((d.name, gd))
    if not mirrors:
        return {"ok": True, "total": 0, "sampled": 0, "ok_count": 0, "tested": []}

    picks = random.sample(mirrors, min(max(1, sample), len(mirrors)))
    tested: list[dict] = []
    tmp_root = tempfile.mkdtemp(prefix="repoark-drill-")
    try:
        for name, gd in picks:
            dest = os.path.join(tmp_root, name)
            entry = {"repo": name, "ok": False, "note": ""}
            try:
                r = subprocess.run(
                    ["git", "clone", "--no-local", "--depth", "1", "--quiet", str(gd), dest],
                    capture_output=True, timeout=300,
                )
                if r.returncode != 0:
                    entry["note"] = r.stderr.decode(errors="replace").strip()[:200] or "clone failed"
                else:
                    head = subprocess.run(["git", "-C", dest, "rev-parse", "HEAD"],
                                          capture_output=True, timeout=30)
                    files = sum(1 for p in Path(dest).rglob("*")
                                if p.is_file() and ".git" not in p.parts)
                    entry["ok"] = True
                    entry["note"] = "boş repo" if head.returncode != 0 else f"{files} dosya"
            except Exception as e:
                entry["note"] = str(e)[:200]
            finally:
                shutil.rmtree(dest, ignore_errors=True)
            tested.append(entry)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    ok_count = sum(1 for e in tested if e["ok"])
    return {
        "ok": ok_count == len(tested),
        "total": len(mirrors),
        "sampled": len(tested),
        "ok_count": ok_count,
        "tested": tested,
    }


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
