"""Background scheduler that triggers jobs on their configured cadence.

APScheduler runs each job on a worker thread. run_job itself decides whether
anything actually changed before downloading, so a frequent interval is cheap
when the account is idle. max_instances=1 prevents a slow backup from
overlapping its next tick.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlmodel import select

from . import backup, config, db
from .models import Job, Run, utcnow

log = logging.getLogger("scheduler")
_scheduler: BackgroundScheduler | None = None


def _run(job_id: int) -> None:
    with db.new_session() as session:
        try:
            backup.run_job(session, job_id, trigger="schedule")
        except Exception:
            log.exception("scheduled job %s failed", job_id)
        _refresh_next_run(session, job_id)


def _trigger_for(job: Job):
    if job.schedule_kind == "interval":
        return IntervalTrigger(minutes=max(1, job.interval_minutes))
    if job.schedule_kind == "cron" and job.cron.strip():
        return CronTrigger.from_crontab(job.cron.strip())
    return None  # manual


def schedule_job(job: Job) -> None:
    """Add or replace the APScheduler entry for a job."""
    if _scheduler is None:
        return
    jid = f"job-{job.id}"
    _scheduler.remove_job(jid) if _scheduler.get_job(jid) else None
    if not job.enabled:
        return
    trigger = _trigger_for(job)
    if trigger is None:
        return
    _scheduler.add_job(
        _run, trigger=trigger, args=[job.id], id=jid,
        max_instances=1, coalesce=True, replace_existing=True,
    )


def unschedule_job(job_id: int) -> None:
    if _scheduler and _scheduler.get_job(f"job-{job_id}"):
        _scheduler.remove_job(f"job-{job_id}")


def _refresh_next_run(session, job_id: int) -> None:
    job = session.get(Job, job_id)
    if not job:
        return
    ap = _scheduler.get_job(f"job-{job_id}") if _scheduler else None
    job.next_run_at = ap.next_run_time.replace(tzinfo=None) if ap and ap.next_run_time else None
    session.add(job)
    session.commit()


def _reset_stale_running(session) -> None:
    """A restart means nothing is actually running; clear leftover 'running'.

    Backups run in-process, so any job/run still marked 'running' after a
    restart was interrupted and will never complete on its own.
    """
    for run in session.exec(select(Run).where(Run.status == "running")).all():
        run.status = "error"
        run.finished_at = utcnow()
        run.log = (run.log or "") + "\n[yeniden başlatma ile kesildi]"
        session.add(run)
    for job in session.exec(select(Job).where(Job.last_status == "running")).all():
        job.last_status = "error"
        session.add(job)
    session.commit()


def start() -> None:
    global _scheduler
    _scheduler = BackgroundScheduler(timezone=config.SCHEDULER_TIMEZONE)
    _scheduler.start()
    with db.new_session() as session:
        _reset_stale_running(session)
        for job in session.exec(select(Job)).all():
            schedule_job(job)
            _refresh_next_run(session, job.id)
    log.info("scheduler started")


def shutdown() -> None:
    if _scheduler:
        _scheduler.shutdown(wait=False)
