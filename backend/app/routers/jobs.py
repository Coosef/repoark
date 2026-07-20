"""Job endpoints: create/update backup configs, run them, wire the scheduler."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import backup, db, engine, progress, scheduler
from ..db import get_session
from ..models import Account, Job, Run
from ..schemas import JobCreate, JobRead, JobUpdate, RunRead

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobRead])
def list_jobs(session: Session = Depends(get_session)):
    return session.exec(select(Job)).all()


@router.post("", response_model=JobRead, status_code=201)
def create_job(payload: JobCreate, session: Session = Depends(get_session)):
    if not session.get(Account, payload.account_id):
        raise HTTPException(404, "Account not found")
    job = Job(**payload.model_dump())
    session.add(job)
    session.commit()
    session.refresh(job)
    scheduler.schedule_job(job)
    return job


@router.put("/{job_id}", response_model=JobRead)
def update_job(job_id: int, payload: JobUpdate, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    for key, value in payload.model_dump().items():
        setattr(job, key, value)
    session.add(job)
    session.commit()
    session.refresh(job)
    scheduler.schedule_job(job)
    return job


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    scheduler.unschedule_job(job_id)
    for run in session.exec(select(Run).where(Run.job_id == job_id)).all():
        session.delete(run)
    session.delete(job)
    session.commit()


@router.post("/{job_id}/run", response_model=RunRead, status_code=202)
def run_now(job_id: int, session: Session = Depends(get_session)):
    """Kick off a backup immediately on a background thread."""
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.last_status == "running":
        raise HTTPException(409, "A backup for this job is already running")

    def _worker():
        with db.new_session() as s:
            backup.run_job(s, job_id, trigger="manual")

    threading.Thread(target=_worker, daemon=True).start()
    # Return the job's latest state; the panel polls runs for progress.
    return RunRead(
        id=0, job_id=job_id, started_at=job.last_run_at or job.created_at,
        status="running", changed=False, trigger="manual",
        summary="", snapshot_path="", log="",
    )


@router.post("/{job_id}/stop", status_code=202)
def stop_now(job_id: int, session: Session = Depends(get_session)):
    """Signal a running backup to stop. It ends as 'cancelled', not a failure."""
    if not session.get(Job, job_id):
        raise HTTPException(404, "Job not found")
    signalled = engine.request_cancel(job_id)
    return {"stopping": True, "signalled": signalled}


@router.get("/{job_id}/progress")
def job_progress(job_id: int):
    """Live progress of the currently running backup (polled by the panel)."""
    return progress.get(job_id)
