"""Run history endpoints (status, logs, versioned snapshots)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, desc, select

from ..db import get_session
from ..models import Run
from ..schemas import RunRead

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("", response_model=list[RunRead])
def list_runs(job_id: int | None = Query(default=None),
              limit: int = Query(default=50, le=500),
              session: Session = Depends(get_session)):
    q = select(Run).order_by(desc(Run.started_at)).limit(limit)
    if job_id is not None:
        q = q.where(Run.job_id == job_id)
    return session.exec(q).all()


@router.get("/{run_id}", response_model=RunRead)
def get_run(run_id: int, session: Session = Depends(get_session)):
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run
