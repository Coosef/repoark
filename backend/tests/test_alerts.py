"""Staleness alert + post-sync verify command shape."""
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app import db, sync
from app.main import app
from app.models import Account, Destination, Job


def test_stale_alert_flags_a_long_idle_scheduled_job():
    db.init_db()
    with db.new_session() as s:
        acc = Account(username="staleuser", token_enc="x")
        s.add(acc)
        s.commit()
        s.refresh(acc)
        old = datetime.utcnow() - timedelta(days=30)
        job = Job(account_id=acc.id, name="idle-daily", enabled=True,
                  schedule_kind="interval", interval_minutes=1440, created_at=old)
        s.add(job)
        s.commit()
        s.refresh(job)
        jid = job.id
    with TestClient(app) as client:
        r = client.get("/api/alerts")
        assert r.status_code == 200
        stale = r.json().get("stale", [])
        assert any(x["job_id"] == jid and x["never"] for x in stale)


def test_fresh_job_is_not_stale():
    db.init_db()
    with db.new_session() as s:
        acc = Account(username="freshuser", token_enc="x")
        s.add(acc)
        s.commit()
        s.refresh(acc)
        job = Job(account_id=acc.id, name="brand-new", enabled=True,
                  schedule_kind="interval", interval_minutes=1440)  # created just now
        s.add(job)
        s.commit()
        s.refresh(job)
        jid = job.id
    with TestClient(app) as client:
        stale = client.get("/api/alerts").json().get("stale", [])
        assert not any(x["job_id"] == jid for x in stale)


def test_verify_uses_rclone_check_size_only(monkeypatch):
    seen = {}
    monkeypatch.setattr(sync, "_run",
                        lambda args, env, timeout: (seen.update(args=args), (0, "ok"))[1])
    d = Destination(name="d", type="local", path="/tmp")
    ok, _ = sync.verify(d, "/local", "user")
    assert ok is True
    assert "check" in seen["args"]
    assert "--size-only" in seen["args"] and "--one-way" in seen["args"]
