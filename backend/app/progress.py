"""In-memory live-progress registry for running backups.

Backups run on background threads inside the same process, so a module-level
dict is enough to publish progress that the panel polls via
GET /api/jobs/{id}/progress. Each entry is a small snapshot of the current
phase, the item being processed, and repo counts.
"""
from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_state: dict[int, dict] = {}


def start(job_id: int, total_repos: int) -> None:
    with _lock:
        _state[job_id] = {
            "running": True,
            "phase": "Hazırlanıyor",
            "message": "",
            "done": 0,
            "total": total_repos,
            "started": time.time(),
            "finished_status": None,
        }


def update(job_id: int, *, phase: str | None = None, message: str | None = None,
           inc: int = 0, total: int | None = None) -> None:
    with _lock:
        st = _state.get(job_id)
        if not st:
            return
        if phase is not None:
            st["phase"] = phase
        if message is not None:
            st["message"] = message
        if total is not None:
            st["total"] = total
        if inc:
            st["done"] += inc


def finish(job_id: int, status: str) -> None:
    with _lock:
        st = _state.get(job_id)
        if st:
            st["running"] = False
            st["phase"] = "Tamamlandı"
            st["finished_status"] = status


def get(job_id: int) -> dict:
    with _lock:
        st = _state.get(job_id)
        if not st:
            return {"running": False}
        out = dict(st)
    out["elapsed"] = round(time.time() - out["started"], 1)
    out["percent"] = (
        round(100 * out["done"] / out["total"]) if out["total"] else 0
    )
    return out
