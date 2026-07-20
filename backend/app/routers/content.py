"""Read-only endpoints that let the panel show what has been backed up.

These read straight from the backup tree on disk (and the run history in the
DB) so the dashboard can display stats, and the browser tabs can list the
actual repos / stars / gists / followers / snapshots that were captured.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import config, crypto, github, health
from ..db import get_session
from ..models import Account, Job, Run
from ..schemas import DeleteReposBody, PruneBody

_SAFE_NAME = re.compile(r"^[\w.\-]+$")   # backed-up repo folder names
# Core backup data that the storage-prune endpoint must never delete.
_PROTECTED_DIRS = {"repositories", "account", "profile"}

router = APIRouter(prefix="/api/accounts", tags=["content"])


def _account(account_id: int, session: Session) -> Account:
    account = session.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    return account


def _current(account: Account) -> Path:
    return config.BACKUPS_DIR / account.username / "current"


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def _breakdown(cur: Path) -> dict:
    """Per-category size split for the storage panel."""
    repos = cur / "repositories"
    repo_code = repo_meta = 0
    if repos.is_dir():
        for d in repos.iterdir():
            if not d.is_dir():
                continue
            code = _dir_size(d / "repository")
            repo_code += code
            repo_meta += max(0, _dir_size(d) - code)  # issues/pulls/wiki JSON
    return {
        "repo_code": repo_code,
        "issue_meta": repo_meta + _dir_size(cur / "account"),  # + starred/repos.json
        "gist": _dir_size(cur / "gists"),
        "social_profile": _dir_size(cur / "profile"),
    }


def _json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


@router.get("/{account_id}/summary")
def summary(account_id: int, session: Session = Depends(get_session)):
    account = _account(account_id, session)
    cur = _current(account)

    stars = _json(cur / "account" / "starred.json", [])
    followers = _json(cur / "profile" / "followers.json", [])
    following = _json(cur / "profile" / "following.json", [])
    repos = cur / "repositories"
    gists = cur / "gists"
    snap_root = config.BACKUPS_DIR / account.username / "snapshots"

    # Runs belonging to this account's jobs (for stats + distribution chart).
    job_ids = {j.id for j in session.exec(
        select(Job).where(Job.account_id == account_id)).all()}
    runs = [r for r in session.exec(select(Run)).all() if r.job_id in job_ids]
    last = max(runs, key=lambda r: r.started_at, default=None)

    return {
        "username": account.username,
        "label": account.label,
        "total_size": _dir_size(cur),
        "breakdown": _breakdown(cur),
        "repos": sum(1 for x in repos.iterdir() if x.is_dir()) if repos.is_dir() else 0,
        "gists": sum(1 for x in gists.iterdir() if x.is_dir()) if gists.is_dir() else 0,
        "stars": len(stars),
        "followers": len(followers),
        "following": len(following),
        "snapshots": sum(1 for x in snap_root.iterdir() if x.is_dir()) if snap_root.is_dir() else 0,
        "last_run": None if not last else {
            "status": last.status,
            "finished_at": last.finished_at,
            "started_at": last.started_at,
            "size_bytes": last.size_bytes,
        },
        "runs_total": len(runs),
        "runs_success": sum(1 for r in runs if r.status == "success"),
        "runs_skipped": sum(1 for r in runs if r.status == "skipped"),
        "runs_error": sum(1 for r in runs if r.status == "error"),
    }


@router.get("/{account_id}/insights")
def insights(account_id: int, session: Session = Depends(get_session)):
    """Language breakdown + stars + public/private, from repos.json metadata."""
    account = _account(account_id, session)
    repos = _json(_current(account) / "account" / "repos.json", [])
    langs: dict[str, int] = {}
    for r in repos:
        lang = r.get("language") or "Diğer"
        langs[lang] = langs.get(lang, 0) + 1
    top_starred = sorted(repos, key=lambda r: r.get("stars") or 0, reverse=True)[:8]
    return {
        "total": len(repos),
        "private": sum(1 for r in repos if r.get("private")),
        "public": sum(1 for r in repos if not r.get("private")),
        "forks": sum(1 for r in repos if r.get("fork")),
        "archived": sum(1 for r in repos if r.get("archived")),
        "total_stars": sum(r.get("stars") or 0 for r in repos),
        "languages": sorted(
            [{"name": k, "count": v} for k, v in langs.items()],
            key=lambda x: x["count"], reverse=True),
        "top_starred": [
            {"name": r.get("name"), "stars": r.get("stars") or 0, "language": r.get("language")}
            for r in top_starred if (r.get("stars") or 0) > 0
        ],
    }


@router.get("/{account_id}/deleted")
def deleted_repos(account_id: int, session: Session = Depends(get_session)):
    """Repos present in the backup but no longer in GitHub's current list.

    A backup tool's job is to keep what GitHub lost. We compare on-disk repos
    against repos.json (refreshed each run with the current remote state). If
    repos.json is missing/empty we can't tell, so we return nothing.
    """
    account = _account(account_id, session)
    cur = _current(account)
    repos_dir = cur / "repositories"
    on_disk = {d.name for d in repos_dir.iterdir() if d.is_dir()} if repos_dir.is_dir() else set()
    current = {r.get("name") for r in _json(cur / "account" / "repos.json", []) if r.get("name")}
    if not current:
        return []
    out = []
    for name in sorted(on_disk - current):
        out.append({"name": name, "size_bytes": _dir_size(repos_dir / name)})
    return out


@router.get("/{account_id}/repos")
def repos(account_id: int, session: Session = Depends(get_session)):
    """List backed-up repos, tagging each as the user's own or a starred clone.

    repositories/ holds both the account's own repos and (when starred_clone is
    on) cloned starred repos. We cross-reference repos.json (owned) and
    starred.json to label each folder so the panel can filter own vs starred.
    """
    account = _account(account_id, session)
    cur = _current(account)
    root = cur / "repositories"
    if not root.is_dir():
        return []

    owned = {r["name"]: r for r in _json(cur / "account" / "repos.json", []) if r.get("name")}
    starred = {}
    for r in _json(cur / "account" / "starred.json", []):
        fn = r.get("full_name") or ""
        nm = fn.split("/")[-1] if fn else r.get("name")
        if nm:
            starred[nm] = r

    out = []
    for d in root.iterdir():
        if not d.is_dir():
            continue
        name = d.name
        if name in owned:
            m = owned[name]
            out.append({"name": name, "size_bytes": _dir_size(d), "kind": "own",
                        "language": m.get("language"), "private": m.get("private"),
                        "fork": m.get("fork"), "archived": m.get("archived"),
                        "stars": m.get("stars"), "full_name": m.get("full_name")})
        elif name in starred:
            m = starred[name]
            out.append({"name": name, "size_bytes": _dir_size(d), "kind": "starred",
                        "language": m.get("language"), "private": m.get("private"),
                        "fork": m.get("fork"), "archived": m.get("archived"),
                        "stars": m.get("stargazers_count"), "full_name": m.get("full_name")})
        else:
            # In repositories/ but in neither list — an orphan clone (e.g. a
            # cancelled starred download) or a repo since deleted from GitHub.
            # Labelled "other" so it's distinguishable and can be cleaned up.
            out.append({"name": name, "size_bytes": _dir_size(d), "kind": "other",
                        "language": None, "private": None, "fork": None,
                        "archived": None, "stars": None, "full_name": None})
    out.sort(key=lambda r: r["size_bytes"], reverse=True)
    return out


@router.get("/{account_id}/storage")
def storage_breakdown(account_id: int, session: Session = Depends(get_session)):
    """Every top-level folder under current/ with its real size on disk.

    Surfaces space that the repo list can't show — e.g. `starred/`, where the
    engine's --all-starred clones land. Sorted largest first.
    """
    account = _account(account_id, session)
    cur = _current(account)
    if not cur.is_dir():
        return []
    out = [
        {"name": d.name, "size_bytes": _dir_size(d), "protected": d.name in _PROTECTED_DIRS}
        for d in cur.iterdir() if d.is_dir()
    ]
    out.sort(key=lambda x: x["size_bytes"], reverse=True)
    return out


@router.post("/{account_id}/storage/prune")
def prune_storage(account_id: int, payload: PruneBody,
                  session: Session = Depends(get_session)):
    """Permanently delete one top-level folder under current/ (e.g. starred/).

    Refuses the protected core folders so a user can't wipe their own repos or
    metadata. Path-guarded to direct children of current/.
    """
    account = _account(account_id, session)
    cur = (_current(account)).resolve()
    name = (payload.name or "").strip()
    if not _SAFE_NAME.match(name) or name in _PROTECTED_DIRS:
        raise HTTPException(400, "Bu klasör silinemez")
    d = (cur / name).resolve()
    if d.parent != cur or not d.is_dir():
        raise HTTPException(404, "Klasör bulunamadı")
    freed = _dir_size(d)
    shutil.rmtree(d, ignore_errors=True)
    return {"freed_bytes": freed}


@router.post("/{account_id}/repos/delete")
def delete_repos(account_id: int, payload: DeleteReposBody,
                 session: Session = Depends(get_session)):
    """Permanently delete backed-up repo folders (own or starred clones).

    Removes <current>/repositories/<name> for each requested name, reclaiming
    disk. Path-guarded so only real subfolders can be deleted.
    """
    account = _account(account_id, session)
    root = (_current(account) / "repositories").resolve()
    deleted, freed = 0, 0
    for name in payload.names:
        if not _SAFE_NAME.match(name or ""):
            continue
        d = (root / name).resolve()
        if d.parent != root or not d.is_dir():
            continue
        freed += _dir_size(d)
        shutil.rmtree(d, ignore_errors=True)
        deleted += 1
    return {"deleted": deleted, "freed_bytes": freed}


@router.get("/{account_id}/starred-live")
def starred_live(account_id: int, session: Session = Depends(get_session)):
    """Fetch the account's starred repos live from GitHub (for the job picker)."""
    account = _account(account_id, session)
    try:
        return github.list_starred(crypto.decrypt(account.token_enc))
    except Exception as e:
        raise HTTPException(502, f"GitHub: {e}")


@router.get("/{account_id}/starred")
def starred(account_id: int, session: Session = Depends(get_session)):
    account = _account(account_id, session)
    data = _json(_current(account) / "account" / "starred.json", [])
    return [
        {
            "full_name": r.get("full_name"),
            "html_url": r.get("html_url"),
            "description": r.get("description"),
            "language": r.get("language"),
            "stars": r.get("stargazers_count"),
        }
        for r in data
    ]


@router.get("/{account_id}/gists")
def gists(account_id: int, session: Session = Depends(get_session)):
    account = _account(account_id, session)
    root = _current(account) / "gists"
    if not root.is_dir():
        return []
    out = []
    for d in root.iterdir():
        if not d.is_dir():
            continue
        meta = _json(d / "gist.json", {})
        out.append({
            "id": d.name,
            "description": meta.get("description") or "",
            "files": list((meta.get("files") or {}).keys()),
        })
    return out


@router.get("/{account_id}/social")
def social(account_id: int, session: Session = Depends(get_session)):
    account = _account(account_id, session)
    cur = _current(account)
    return {
        "followers": _json(cur / "profile" / "followers.json", []),
        "following": _json(cur / "profile" / "following.json", []),
        "profile": _json(cur / "profile" / "user.json", {}),
    }


@router.get("/{account_id}/snapshots")
def snapshots(account_id: int, session: Session = Depends(get_session)):
    account = _account(account_id, session)
    root = config.BACKUPS_DIR / account.username / "snapshots"
    if not root.is_dir():
        return []
    out = []
    for d in sorted(root.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        files = sum(1 for _ in d.rglob("*") if _.is_file())
        out.append({"name": d.name, "size_bytes": _dir_size(d), "files": files})
    return out


@router.get("/{account_id}/changes")
def changes(account_id: int, session: Session = Depends(get_session)):
    """What changed between the two most recent backups (from their snapshots).

    Compares the repos.json + starred.json captured in each dated snapshot, so
    the dashboard can answer "what happened since last time?" — new/removed
    repos, which repos got new commits, and how the star count moved.
    """
    account = _account(account_id, session)
    root = config.BACKUPS_DIR / account.username / "snapshots"
    if not root.is_dir():
        return {"has_data": False}
    snaps = sorted([d for d in root.iterdir() if d.is_dir()], key=lambda d: d.name)
    if len(snaps) < 2:
        return {"has_data": False}
    new_dir, old_dir = snaps[-1], snaps[-2]

    def _repos(d):
        return {r["full_name"]: r for r in _json(d / "account" / "repos.json", []) if r.get("full_name")}

    new_repos, old_repos = _repos(new_dir), _repos(old_dir)
    short = lambda fn: fn.split("/")[-1]
    added = sorted(short(n) for n in new_repos.keys() - old_repos.keys())
    removed = sorted(short(n) for n in old_repos.keys() - new_repos.keys())
    updated = sorted(
        short(fn) for fn in (new_repos.keys() & old_repos.keys())
        if new_repos[fn].get("pushed_at") != old_repos[fn].get("pushed_at")
    )
    return {
        "has_data": True,
        "from": old_dir.name, "to": new_dir.name,
        "added": added, "removed": removed, "updated": updated,
        "stars_before": len(_json(old_dir / "account" / "starred.json", [])),
        "stars_after": len(_json(new_dir / "account" / "starred.json", [])),
    }


@router.get("/{account_id}/health")
def get_health(account_id: int, session: Session = Depends(get_session)):
    """Last stored integrity status for this account's backup."""
    account = _account(account_id, session)
    return {
        "status": account.health_status or "unknown",
        "note": account.health_note,
        "checked_at": account.health_checked_at,
    }


@router.post("/{account_id}/health/check")
def run_health(account_id: int, session: Session = Depends(get_session)):
    """Run git fsck across the backed-up repos now and store the result."""
    account = _account(account_id, session)
    result = health.update_account_health(session, account)
    return {
        "status": account.health_status,
        "note": account.health_note,
        "checked_at": account.health_checked_at,
        **result,
    }
