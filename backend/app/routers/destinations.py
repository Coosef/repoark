"""Remote destination (S3) management: CRUD, connection test, manual sync."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from .. import crypto, db, sync
from ..db import get_session
from ..models import Account, Destination
from ..schemas import DestinationCreate, DestinationRead, DestinationUpdate

router = APIRouter(prefix="/api/destinations", tags=["destinations"])


def _to_read(d: Destination) -> DestinationRead:
    return DestinationRead(
        id=d.id, name=d.name, type=d.type, enabled=d.enabled, endpoint=d.endpoint,
        region=d.region, bucket=d.bucket, prefix=d.prefix, access_key=d.access_key,
        path=d.path, secret_key_set=bool(d.secret_key_enc), last_sync_at=d.last_sync_at,
        last_sync_status=d.last_sync_status, last_sync_log=d.last_sync_log,
    )


@router.get("", response_model=list[DestinationRead])
def list_destinations(session: Session = Depends(get_session)):
    return [_to_read(d) for d in session.exec(select(Destination)).all()]


@router.post("", response_model=DestinationRead, status_code=201)
def create(payload: DestinationCreate, session: Session = Depends(get_session)):
    d = Destination(**payload.model_dump(exclude={"secret_key"}))
    if payload.secret_key:
        d.secret_key_enc = crypto.encrypt(payload.secret_key)
    session.add(d)
    session.commit()
    session.refresh(d)
    return _to_read(d)


@router.put("/{dest_id}", response_model=DestinationRead)
def update(dest_id: int, payload: DestinationUpdate, session: Session = Depends(get_session)):
    d = session.get(Destination, dest_id)
    if not d:
        raise HTTPException(404, "Destination not found")
    for k, v in payload.model_dump(exclude={"secret_key"}).items():
        setattr(d, k, v)
    if payload.secret_key:
        d.secret_key_enc = crypto.encrypt(payload.secret_key)
    session.add(d)
    session.commit()
    session.refresh(d)
    return _to_read(d)


@router.delete("/{dest_id}", status_code=204)
def delete(dest_id: int, session: Session = Depends(get_session)):
    d = session.get(Destination, dest_id)
    if not d:
        raise HTTPException(404, "Destination not found")
    session.delete(d)
    session.commit()


@router.post("/{dest_id}/test")
def test(dest_id: int, session: Session = Depends(get_session)):
    d = session.get(Destination, dest_id)
    if not d:
        raise HTTPException(404, "Destination not found")
    ok, log = sync.test(d)
    return {"ok": ok, "log": log}


@router.post("/{dest_id}/sync", status_code=202)
def sync_now(dest_id: int, account_id: int = Query(...),
             session: Session = Depends(get_session)):
    d = session.get(Destination, dest_id)
    account = session.get(Account, account_id)
    if not d or not account:
        raise HTTPException(404, "Destination or account not found")
    if d.last_sync_status == "running":
        raise HTTPException(409, "Bu hedef için senkronizasyon zaten sürüyor")

    def _worker():
        with db.new_session() as s:
            dest = s.get(Destination, dest_id)
            acc = s.get(Account, account_id)
            sync.sync_account(s, dest, acc)

    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started"}
