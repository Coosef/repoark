"""Backup orchestration: change detection -> engine run -> versioned snapshot.

A single entry point, run_job(job_id, trigger), is called both by the "Run now"
button and by the scheduler. It:

  1. Computes a fingerprint of the account's current remote state (cheap API).
  2. Compares it to the fingerprint from the last run. If skip_unchanged is on
     and nothing changed, it records a "skipped" run and returns early.
  3. Otherwise runs github-backup (incremental) into <account>/current/.
  4. Writes the profile/social bundle and a dated JSON metadata snapshot so
     the history of stars/gists/issues/profile is versioned. Repo code history
     is preserved by the bare git mirrors themselves.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from sqlmodel import Session

from . import config, crypto, engine, github, health, notify, progress, sync
from .models import Account, Job, Run, utcnow

# github-backup logs "Retrieving <owner>/<repo> issues" once per repository —
# a reliable per-repo marker for both fresh clones and incremental updates.
_ISSUES_RE = re.compile(r"Retrieving (\S+) issues")
# Destination path in the real-time "Cloning <name> repository from ... to <dest>" line.
_CLONE_RE = re.compile(r"/(repositories|gists)/([^/]+)/repository")


def account_dir(username: str) -> Path:
    return config.BACKUPS_DIR / username


def _write_profile(out_dir: Path, token: str) -> int:
    """Fetch and store profile + social graph under <current>/profile/.

    Returns follower+following count. Always writes user.json if the profile
    fetch succeeds; social lists that the token cannot read are written empty
    with a notes.txt explaining why.
    """
    pdir = out_dir / "profile"
    pdir.mkdir(parents=True, exist_ok=True)
    try:
        bundle = github.fetch_profile_bundle(token)
    except Exception as e:  # non-fatal; the rest of the backup still counts
        (pdir / "error.txt").write_text(str(e))
        return 0
    (pdir / "user.json").write_text(json.dumps(bundle["user"], indent=2))
    (pdir / "followers.json").write_text(json.dumps(bundle["followers"], indent=2))
    (pdir / "following.json").write_text(json.dumps(bundle["following"], indent=2))
    # Refresh advisory files so stale notes from a previous (more limited) token
    # do not linger and mislead.
    (pdir / "error.txt").unlink(missing_ok=True)
    if bundle.get("notes"):
        (pdir / "notes.txt").write_text("\n".join(bundle["notes"]))
    else:
        (pdir / "notes.txt").unlink(missing_ok=True)
    return len(bundle["followers"]) + len(bundle["following"])


def _snapshot_metadata(current: Path, snap_dir: Path) -> int:
    """Copy every JSON metadata file (small) into a dated snapshot dir.

    This versions the non-git data (issues, gists, stars, profile). The bare
    repo mirrors are intentionally excluded — their own git history is the
    version record, and copying them every run would waste space.
    """
    count = 0
    for src in current.rglob("*.json"):
        if ".git" in src.parts:
            continue
        rel = src.relative_to(current)
        dst = snap_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        count += 1
    return count


def _dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for p in path.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def _fs_counts(current: Path) -> dict[str, int]:
    """Count backed-up items directly from the filesystem."""
    def _count_dirs(p: Path) -> int:
        return sum(1 for x in p.iterdir() if x.is_dir()) if p.is_dir() else 0

    def _json_len(p: Path) -> int:
        try:
            return len(json.loads(p.read_text()))
        except Exception:
            return 0

    return {
        "repos": _count_dirs(current / "repositories"),
        "gists": _count_dirs(current / "gists"),
        "stars": _json_len(current / "account" / "starred.json"),
        "followers": _json_len(current / "profile" / "followers.json"),
    }


def _make_progress_cb(job_id: int, issues_enabled: bool):
    """Return an on_line callback that turns engine output into progress.

    Per-repo counting uses the "Retrieving <repo> issues" line (one per repo,
    fires on both fresh clones and incremental updates). When issues are not
    part of the job we fall back to the real-time "Cloning <name> repository
    from ..." line, which only appears for repos actually cloned.
    """
    def cb(line: str) -> None:
        if issues_enabled:
            m = _ISSUES_RE.search(line)
            if m:
                progress.update(job_id, phase="Repolar", message=m.group(1), inc=1)
                return
        elif "Cloning" in line and "repository from" in line:
            m = _CLONE_RE.search(line)
            if m and m.group(1) == "repositories":
                progress.update(job_id, phase="Repolar", message=m.group(2), inc=1)
                return
        if "starred repositories to disk" in line:
            progress.update(job_id, phase="Yıldızlar")
        elif "Cloning" in line and "/gists/" in line:
            progress.update(job_id, phase="Gist'ler")
    return cb


def _prune_snapshots(username: str, keep: int) -> None:
    """Delete metadata snapshots beyond the most recent `keep` (retention)."""
    root = account_dir(username) / "snapshots"
    if keep <= 0 or not root.is_dir():
        return
    snaps = sorted([d for d in root.iterdir() if d.is_dir()], key=lambda d: d.name)
    for d in snaps[:-keep]:
        shutil.rmtree(d, ignore_errors=True)


def _check_token_expiry(session: Session, account: Account, token: str) -> None:
    """Record the token's expiry and warn once when it is about to lapse."""
    try:
        exp = github.token_expiry(token)
    except Exception:
        return
    account.token_expires_at = exp
    if exp is not None:
        days = (exp - utcnow()).total_seconds() / 86400
        if days <= 7 and not account.token_warned:
            try:
                s = notify.get_settings(session)
                notify.send(
                    s, "⚠️ GitHub token süresi doluyor",
                    f"@{account.username} hesabının token'ı "
                    f"{max(0, int(days))} gün içinde dolacak. Lütfen yenileyin.",
                )
            except Exception:
                pass
            account.token_warned = True
        elif days > 7:
            account.token_warned = False   # renewed safely — allow future warnings
    try:
        session.add(account)
        session.commit()
    except Exception:
        pass


def _finalize(session: Session, account: Account, job: Job, run: Run, *, prune: bool) -> None:
    """Retention + notifications. Never lets these break the backup result."""
    try:
        s = notify.get_settings(session)
        if prune and s.snapshot_retention > 0:
            _prune_snapshots(account.username, s.snapshot_retention)
        notify.notify_run(s, account, job, run)
    except Exception:
        pass
    # After a successful backup, verify integrity + push to remote destinations.
    if prune:
        try:
            health.update_account_health(session, account)
        except Exception:
            pass
        try:
            sync.sync_all_enabled(session, account)
        except Exception:
            pass


def _job_options(job: Job) -> dict:
    return {
        "repos": job.repos, "private": job.private, "forks": job.forks,
        "wikis": job.wikis, "issues": job.issues, "starred": job.starred,
        "gists": job.gists, "releases": job.releases,
        "starred_clone": job.starred_clone,
        "skip_archived": job.skip_archived, "exclude": job.exclude,
    }


def run_job(session: Session, job_id: int, trigger: str = "manual") -> Run:
    job = session.get(Job, job_id)
    if job is None:
        raise ValueError(f"job {job_id} not found")
    account = session.get(Account, job.account_id)
    if account is None:
        raise ValueError(f"account {job.account_id} not found")

    token = crypto.decrypt(account.token_enc)
    run = Run(job_id=job_id, trigger=trigger, status="running")
    session.add(run)
    job.last_status = "running"
    job.last_run_at = utcnow()
    session.add(job)
    session.commit()
    session.refresh(run)
    progress.start(job_id, 0)

    try:
        # 1 + 2: change detection
        progress.update(job_id, phase="Değişiklik kontrolü")
        _check_token_expiry(session, account, token)
        org = account.username if account.is_org else ""
        new_fp, counts, repos_meta = github.compute_fingerprint(
            token, repos=job.repos, private=job.private, forks=job.forks,
            issues=job.issues, starred=job.starred, gists=job.gists, org=org,
        )
        progress.update(job_id, total=counts["repos"])
        old_fp = json.loads(job.last_fingerprint) if job.last_fingerprint else {}
        changed_cats = github.diff_fingerprints(old_fp, new_fp)

        # Refresh repo metadata (for dashboard insights) even on skipped runs —
        # it's already fetched above and is cheap to persist.
        out_dir = account_dir(account.username) / "current"
        if repos_meta:
            (out_dir / "account").mkdir(parents=True, exist_ok=True)
            (out_dir / "account" / "repos.json").write_text(json.dumps(repos_meta, indent=2))

        if job.skip_unchanged and old_fp and not changed_cats:
            run.status = "skipped"
            run.changed = False
            run.finished_at = utcnow()
            run.summary = json.dumps({"note": "no changes detected"})
            job.last_status = "skipped"
            job.consecutive_failures = 0
            session.add_all([run, job])
            session.commit()
            session.refresh(run)
            progress.finish(job_id, "skipped")
            _finalize(session, account, job, run, prune=False)
            return run

        # 3: run the engine (streams progress via the callback)
        progress.update(job_id, phase="Repolar", message="başlıyor…")
        opts = _job_options(job)
        opts["organization"] = account.is_org
        code, log = engine.run_backup(
            account.username, token, out_dir, options=opts,
            on_line=_make_progress_cb(job_id, job.issues),
        )

        # profile/social captured directly (skipped for orgs — user-scoped)
        social_count = 0
        if not account.is_org:
            progress.update(job_id, phase="Profil & sosyal")
            social_count = _write_profile(out_dir, token)

        # 4: dated metadata snapshot for version history
        progress.update(job_id, phase="Snapshot")
        stamp = utcnow().strftime("%Y%m%d-%H%M%S")
        snap_dir = account_dir(account.username) / "snapshots" / stamp
        json_count = _snapshot_metadata(out_dir, snap_dir)

        # 5: measure the result for stats + charts
        fs = _fs_counts(out_dir)
        run.size_bytes = _dir_size(out_dir)
        run.repo_count = fs["repos"]
        run.star_count = fs["stars"]
        run.gist_count = fs["gists"]
        run.follower_count = fs["followers"]

        summary = {
            "changed_categories": changed_cats or list(new_fp.keys()),
            "engine_exit": code,
            "metadata_files": json_count,
            "social_entries": social_count,
        }

        if code == 0:
            run.status = "success"
            run.changed = True
            job.last_fingerprint = json.dumps(new_fp)
            job.last_status = "success"
            job.consecutive_failures = 0
        else:
            run.status = "error"
            job.last_status = "error"
            job.consecutive_failures = (job.consecutive_failures or 0) + 1

        run.finished_at = utcnow()
        run.summary = json.dumps(summary)
        run.snapshot_path = str(snap_dir)
        run.log = log[-20000:]  # keep the tail; logs can be long
        session.add_all([run, job])
        session.commit()
        session.refresh(run)
        progress.finish(job_id, run.status)
        _finalize(session, account, job, run, prune=(run.status == "success"))
        return run

    except Exception as e:
        run.status = "error"
        run.finished_at = utcnow()
        run.log = f"{type(e).__name__}: {e}"
        job.last_status = "error"
        job.consecutive_failures = (job.consecutive_failures or 0) + 1
        session.add_all([run, job])
        session.commit()
        session.refresh(run)
        progress.finish(job_id, "error")
        _finalize(session, account, job, run, prune=False)
        return run
