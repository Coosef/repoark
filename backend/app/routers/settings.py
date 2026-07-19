"""Settings (notifications + retention) and storage management endpoints."""
from __future__ import annotations

import shutil
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from .. import backup, config, crypto, notify, scheduler
from ..db import get_session
from ..models import Account, Destination, Job, Settings, utcnow
from ..schemas import SettingsRead, SettingsUpdate

router = APIRouter(prefix="/api", tags=["settings"])

# Config fields carried by export/import (setup only — no runtime/history state).
_JOB_FIELDS = ("name", "repos", "private", "forks", "wikis", "issues", "starred",
               "starred_clone", "gists", "releases", "skip_archived", "exclude",
               "enabled", "schedule_kind", "interval_minutes", "cron", "skip_unchanged")
_DEST_FIELDS = ("name", "type", "enabled", "endpoint", "region", "bucket",
                "prefix", "access_key", "path")
_SETTINGS_FIELDS = ("email_enabled", "smtp_host", "smtp_port", "smtp_user", "smtp_from",
                    "smtp_to", "smtp_tls", "telegram_enabled", "telegram_chat_id",
                    "notify_on_success", "notify_on_error", "notify_on_change",
                    "snapshot_retention")


def _to_read(s: Settings) -> SettingsRead:
    return SettingsRead(
        email_enabled=s.email_enabled, smtp_host=s.smtp_host, smtp_port=s.smtp_port,
        smtp_user=s.smtp_user, smtp_from=s.smtp_from, smtp_to=s.smtp_to, smtp_tls=s.smtp_tls,
        smtp_pass_set=bool(s.smtp_pass_enc),
        telegram_enabled=s.telegram_enabled, telegram_chat_id=s.telegram_chat_id,
        telegram_token_set=bool(s.telegram_token_enc),
        notify_on_success=s.notify_on_success, notify_on_error=s.notify_on_error,
        notify_on_change=s.notify_on_change, snapshot_retention=s.snapshot_retention,
    )


@router.get("/settings", response_model=SettingsRead)
def get_settings(session: Session = Depends(get_session)):
    return _to_read(notify.get_settings(session))


@router.put("/settings", response_model=SettingsRead)
def update_settings(payload: SettingsUpdate, session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    for field in ("email_enabled", "smtp_host", "smtp_port", "smtp_user", "smtp_from",
                  "smtp_to", "smtp_tls", "telegram_enabled", "telegram_chat_id",
                  "notify_on_success", "notify_on_error", "notify_on_change",
                  "snapshot_retention"):
        setattr(s, field, getattr(payload, field))
    # Secrets: only replace when a new value is supplied (blank keeps the old).
    if payload.smtp_pass:
        s.smtp_pass_enc = crypto.encrypt(payload.smtp_pass)
    if payload.telegram_token:
        s.telegram_token_enc = crypto.encrypt(payload.telegram_token)
    session.add(s)
    session.commit()
    session.refresh(s)
    return _to_read(s)


@router.post("/settings/test")
def test_notification(session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    if not (s.email_enabled or s.telegram_enabled):
        return {"ok": False, "errors": ["Hiçbir bildirim kanalı etkin değil."]}
    errors = notify.send(s, "🔔 Test bildirimi",
                         "GitHub Yedekleme Paneli test mesajı. Bildirimler çalışıyor.")
    return {"ok": not errors, "errors": errors}


@router.get("/config/export")
def export_config(session: Session = Depends(get_session)):
    """Download the whole panel setup (accounts, jobs, targets, settings).

    Secrets (tokens, passwords) are DECRYPTED into the file so it can be
    restored on a fresh container (e.g. after moving to CasaOS). The file is
    sensitive — the panel warns the user to keep it safe.
    """
    accounts = session.exec(select(Account)).all()
    jobs = session.exec(select(Job)).all()
    dests = session.exec(select(Destination)).all()
    s = notify.get_settings(session)
    acc_by_id = {a.id: a for a in accounts}
    data = {
        "app": "RepoArk", "version": 1,
        "accounts": [
            {"label": a.label, "username": a.username, "is_org": a.is_org,
             "token": crypto.decrypt(a.token_enc) if a.token_enc else ""}
            for a in accounts
        ],
        "jobs": [
            {**{k: getattr(j, k) for k in _JOB_FIELDS},
             "account_username": acc_by_id[j.account_id].username if j.account_id in acc_by_id else None}
            for j in jobs
        ],
        "destinations": [
            {**{k: getattr(d, k) for k in _DEST_FIELDS},
             "secret_key": crypto.decrypt(d.secret_key_enc) if d.secret_key_enc else ""}
            for d in dests
        ],
        "settings": {
            **{k: getattr(s, k) for k in _SETTINGS_FIELDS},
            "smtp_pass": crypto.decrypt(s.smtp_pass_enc) if s.smtp_pass_enc else "",
            "telegram_token": crypto.decrypt(s.telegram_token_enc) if s.telegram_token_enc else "",
            "panel_password_hash": s.panel_password_hash,
        },
    }
    return JSONResponse(data, headers={
        "Content-Disposition": 'attachment; filename="repoark-config.json"'})


@router.post("/config/import")
def import_config(payload: dict, session: Session = Depends(get_session)):
    """Restore a setup exported by /config/export. Adds what's missing; never
    deletes. Secrets are re-encrypted with this container's key."""
    result = {"accounts": 0, "jobs": 0, "destinations": 0, "settings": False}

    accounts = {a.username: a for a in session.exec(select(Account)).all()}
    for a in payload.get("accounts", []):
        un = (a.get("username") or "").strip()
        if not un or un in accounts:
            continue
        acc = Account(label=a.get("label") or un, username=un,
                      is_org=bool(a.get("is_org")),
                      token_enc=crypto.encrypt(a["token"]) if a.get("token") else "")
        session.add(acc)
        session.commit()
        session.refresh(acc)
        accounts[un] = acc
        result["accounts"] += 1

    existing_jobs = {(j.account_id, j.name) for j in session.exec(select(Job)).all()}
    new_jobs = []
    for j in payload.get("jobs", []):
        acc = accounts.get(j.get("account_username"))
        if not acc or (acc.id, j.get("name")) in existing_jobs:
            continue
        job = Job(account_id=acc.id, **{k: j[k] for k in _JOB_FIELDS if k in j})
        session.add(job)
        new_jobs.append(job)
        result["jobs"] += 1
    session.commit()
    for job in new_jobs:
        session.refresh(job)
        try:
            scheduler.schedule_job(job)
        except Exception:
            pass

    dest_names = {d.name for d in session.exec(select(Destination)).all()}
    for d in payload.get("destinations", []):
        if not d.get("name") or d["name"] in dest_names:
            continue
        dest = Destination(**{k: d[k] for k in _DEST_FIELDS if k in d},
                           secret_key_enc=crypto.encrypt(d["secret_key"]) if d.get("secret_key") else "")
        session.add(dest)
        result["destinations"] += 1
    session.commit()

    st = payload.get("settings")
    if isinstance(st, dict):
        s = notify.get_settings(session)
        for k in _SETTINGS_FIELDS:
            if k in st:
                setattr(s, k, st[k])
        if st.get("smtp_pass"):
            s.smtp_pass_enc = crypto.encrypt(st["smtp_pass"])
        if st.get("telegram_token"):
            s.telegram_token_enc = crypto.encrypt(st["telegram_token"])
        if st.get("panel_password_hash"):
            s.panel_password_hash = st["panel_password_hash"]
        session.add(s)
        session.commit()
        result["settings"] = True

    return result


@router.get("/alerts")
def alerts(session: Session = Depends(get_session)):
    """Proactive warnings for the dashboard: expiring tokens + failing jobs."""
    now = utcnow()
    token_alerts = []
    for acc in session.exec(select(Account)).all():
        exp = acc.token_expires_at
        if not exp:
            continue
        days = (exp - now).total_seconds() / 86400
        if days <= 14:
            token_alerts.append({
                "account_id": acc.id,
                "username": acc.username,
                "expires_at": exp,
                "days": int(days) if days >= 0 else int(days),  # negative = expired
                "expired": days < 0,
            })
    accounts_by_id = {a.id: a for a in session.exec(select(Account)).all()}
    failing = []
    for job in session.exec(select(Job)).all():
        if job.last_status == "error" and (job.consecutive_failures or 0) >= 1:
            acc = accounts_by_id.get(job.account_id)
            failing.append({
                "job_id": job.id,
                "job_name": job.name,
                "username": acc.username if acc else "?",
                "failures": job.consecutive_failures or 1,
                "last_run_at": job.last_run_at,
            })
    return {"token": token_alerts, "failing": failing}


@router.get("/storage")
def storage(session: Session = Depends(get_session)):
    du = shutil.disk_usage(str(config.DATA_DIR))
    accounts = []
    for acc in session.exec(select(Account)).all():
        d = config.BACKUPS_DIR / acc.username
        size = sum(p.stat().st_size for p in d.rglob("*") if p.is_file()) if d.is_dir() else 0
        snaps = (d / "snapshots")
        n_snaps = sum(1 for x in snaps.iterdir() if x.is_dir()) if snaps.is_dir() else 0
        accounts.append({"username": acc.username, "size": size, "snapshots": n_snaps})
    return {
        "disk_total": du.total, "disk_used": du.used, "disk_free": du.free,
        "backups_size": sum(a["size"] for a in accounts),
        "accounts": accounts,
    }


@router.post("/storage/prune")
def prune(session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    keep = s.snapshot_retention
    if keep <= 0:
        return {"pruned": 0, "note": "Saklama sınırı ayarlı değil (0 = sınırsız)."}
    before = 0
    after = 0
    for acc in session.exec(select(Account)).all():
        root = config.BACKUPS_DIR / acc.username / "snapshots"
        if root.is_dir():
            before += sum(1 for x in root.iterdir() if x.is_dir())
        backup._prune_snapshots(acc.username, keep)
        if root.is_dir():
            after += sum(1 for x in root.iterdir() if x.is_dir())
    return {"pruned": before - after, "kept_per_account": keep}
