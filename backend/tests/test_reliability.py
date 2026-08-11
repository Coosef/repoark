"""Backup-engine reliability tests (Tier-2 correctness guarantees).

All network / engine calls are monkeypatched, so these run with no GitHub token
and no real cloning — they verify the decision logic that protects backup
integrity: no false success, no fingerprint advance on a partial run, a disk
guard, single-run-per-job locking, and run-history retention.
"""
import json
import signal
import subprocess
import time

import pytest
from sqlalchemy import text
from sqlmodel import select

from app import backup, crypto, db, engine
import app.github as github
from app.models import Account, Job, Run

FP = {"repos": "hash1"}


@pytest.fixture()
def job_id():
    """A fresh account + selected-starred job inserted straight into the DB."""
    db.init_db()
    with db.new_session() as s:
        acc = Account(username="tester", token_enc=crypto.encrypt("faketoken"), is_org=False)
        s.add(acc)
        s.commit()
        s.refresh(acc)
        job = Job(account_id=acc.id, name="t", repos=True, private=True, starred=True,
                  starred_clone=True, starred_repos=json.dumps(["a/b", "c/d"]),
                  skip_unchanged=True, last_fingerprint="")
        s.add(job)
        s.commit()
        s.refresh(job)
        return job.id


@pytest.fixture()
def stub_engine(monkeypatch):
    """Neutralize everything in run_job that would hit the network or heavy fs."""
    monkeypatch.setattr(github, "compute_fingerprint",
                        lambda *a, **k: (dict(FP), {"repos": 2}, [{"name": "r"}]))
    monkeypatch.setattr(backup, "_check_token_expiry", lambda *a, **k: None)
    monkeypatch.setattr(backup, "_write_profile", lambda *a, **k: 0)
    monkeypatch.setattr(backup, "_snapshot_metadata", lambda *a, **k: 0)
    monkeypatch.setattr(backup, "_finalize", lambda *a, **k: None)
    monkeypatch.setattr(engine, "run_backup", lambda *a, **k: (0, "engine ok\n"))


def test_sqlite_uses_wal_and_busy_timeout():
    with db.get_engine().connect() as c:
        assert str(c.execute(text("PRAGMA journal_mode")).scalar()).lower() == "wal"
        assert int(c.execute(text("PRAGMA busy_timeout")).scalar()) == 30000


def test_signal_group_kills_whole_tree():
    p = subprocess.Popen(["sh", "-c", "sleep 60"], start_new_session=True)
    engine._signal_group(p, signal.SIGKILL)
    time.sleep(0.5)
    assert p.poll() is not None


def test_job_lock_is_stable_per_id():
    assert backup._job_lock(1234) is backup._job_lock(1234)


def test_full_success_advances_fingerprint(job_id, stub_engine, monkeypatch):
    monkeypatch.setattr(backup, "_clone_selected_starred", lambda *a, **k: (2, 0))
    with db.new_session() as s:
        r = backup.run_job(s, job_id, "manual")
        j = s.get(Job, job_id)
    assert r.status == "success"
    assert j.last_fingerprint == json.dumps(FP)


def test_partial_does_not_advance_fingerprint(job_id, stub_engine, monkeypatch):
    monkeypatch.setattr(backup, "_clone_selected_starred", lambda *a, **k: (1, 1))
    with db.new_session() as s:
        r = backup.run_job(s, job_id, "manual")
        j = s.get(Job, job_id)
    assert r.status == "partial"
    assert j.last_fingerprint == ""          # must retry the failed repos next run
    assert "klonlanamadı" in (r.log or "")


def test_disk_guard_blocks_backup(job_id, stub_engine, monkeypatch):
    monkeypatch.setattr(backup, "_MIN_FREE_BYTES", 10 ** 18)   # 1 EB: always insufficient
    def _boom(*a, **k):
        raise AssertionError("engine ran despite low disk")
    monkeypatch.setattr(engine, "run_backup", _boom)
    with db.new_session() as s:
        r = backup.run_job(s, job_id, "manual")
    assert r.status == "error"
    assert "disk" in (r.log or "").lower()


def test_concurrent_run_is_refused(job_id, stub_engine, monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("a second engine started while the job was locked")
    monkeypatch.setattr(engine, "run_backup", _boom)
    lk = backup._job_lock(job_id)
    lk.acquire()
    try:
        with db.new_session() as s:
            r = backup.run_job(s, job_id, "manual")   # must return without running
        assert r is not None
    finally:
        lk.release()


def test_run_history_is_capped(job_id, monkeypatch):
    monkeypatch.setattr(backup, "_RUN_KEEP", 50)
    with db.new_session() as s:
        for _ in range(80):
            s.add(Run(job_id=job_id, status="success"))
        s.commit()
        backup._prune_runs(s, job_id)
        n = len(s.exec(select(Run).where(Run.job_id == job_id)).all())
    assert n == 50
