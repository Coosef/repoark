"""Account endpoints: connect a GitHub account (validate + store token)."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import crypto, github
from ..db import get_session
from ..models import Account, Job
from ..schemas import AccountCreate, AccountRead, AccountUpdate

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountRead])
def list_accounts(session: Session = Depends(get_session)):
    return session.exec(select(Account)).all()


@router.post("", response_model=AccountRead, status_code=201)
def connect_account(payload: AccountCreate, session: Session = Depends(get_session)):
    token = payload.token.strip()
    if not token:
        raise HTTPException(400, "Token is required")
    org = (payload.org or "").strip()
    try:
        if org:
            obj = github.validate_org(token, org)
            login, is_org = obj["login"], True
        else:
            obj = github.validate_token(token)
            login, is_org = obj["login"], False
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise HTTPException(400, "Invalid or expired token")
        if e.response.status_code == 404 and org:
            raise HTTPException(400, "Organizasyon bulunamadı veya token erişemiyor")
        raise HTTPException(502, f"GitHub error: {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach GitHub: {e}")

    account = Account(
        label=payload.label or login,
        username=login,
        is_org=is_org,
        token_enc=crypto.encrypt(token),
        token_expires_at=github.token_expiry(token),
    )
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


@router.put("/{account_id}", response_model=AccountRead)
def update_token(account_id: int, payload: AccountUpdate,
                 session: Session = Depends(get_session)):
    """Replace an account's token (e.g. rotating an expired one)."""
    account = session.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    token = payload.token.strip()
    if not token:
        raise HTTPException(400, "Token is required")
    try:
        user = github.validate_token(token)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise HTTPException(400, "Invalid or expired token")
        raise HTTPException(502, f"GitHub error: {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach GitHub: {e}")

    account.username = user["login"]
    account.token_enc = crypto.encrypt(token)
    account.token_expires_at = github.token_expiry(token)
    account.token_warned = False          # fresh token — re-arm expiry warnings
    if payload.label:
        account.label = payload.label
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, session: Session = Depends(get_session)):
    account = session.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    # Refuse if jobs still reference it, to avoid orphaned schedules.
    jobs = session.exec(select(Job).where(Job.account_id == account_id)).all()
    if jobs:
        raise HTTPException(409, "Delete the account's backup jobs first")
    session.delete(account)
    session.commit()
