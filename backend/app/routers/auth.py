"""Panel login: status, login, logout, and setting/changing the password.

When no password is configured the panel is open (first-run friendly). Once a
password is set, every /api/* route (except /api/auth/* and /api/health) is
guarded by the middleware in main.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session

from .. import auth, notify
from ..db import get_session
from ..schemas import LoginBody, PasswordBody

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
def status(request: Request, session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    enabled = bool(s.panel_password_hash)
    authed = (not enabled) or auth.valid_session(request.cookies.get(auth.COOKIE_NAME, ""))
    return {"enabled": enabled, "authed": authed}


@router.post("/login")
def login(payload: LoginBody, response: Response, session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    if not s.panel_password_hash:
        raise HTTPException(400, "Panel şifresi ayarlı değil")
    if not auth.verify_password(payload.password, s.panel_password_hash):
        raise HTTPException(401, "Şifre yanlış")
    response.set_cookie(
        auth.COOKIE_NAME, auth.make_session(),
        httponly=True, samesite="lax", max_age=auth.SESSION_TTL,
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.post("/set-password")
def set_password(payload: PasswordBody, request: Request, response: Response,
                 session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    logged_in = auth.valid_session(request.cookies.get(auth.COOKIE_NAME, ""))
    # Changing/removing an existing password needs proof: a live session or the
    # current password.
    if s.panel_password_hash and not (logged_in or auth.verify_password(payload.current, s.panel_password_hash)):
        raise HTTPException(401, "Mevcut şifre gerekli")

    new = (payload.new or "").strip()
    if not new:
        # Empty new password disables protection entirely.
        s.panel_password_hash = ""
        session.add(s)
        session.commit()
        response.delete_cookie(auth.COOKIE_NAME)
        return {"ok": True, "enabled": False}

    if len(new) < 4:
        raise HTTPException(400, "Şifre en az 4 karakter olmalı")
    s.panel_password_hash = auth.hash_password(new)
    session.add(s)
    session.commit()
    response.set_cookie(
        auth.COOKIE_NAME, auth.make_session(),
        httponly=True, samesite="lax", max_age=auth.SESSION_TTL,
    )
    return {"ok": True, "enabled": True}
