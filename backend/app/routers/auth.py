"""Panel login: status, login, logout, and setting/changing the password.

When no password is configured the panel is open (first-run friendly). Once a
password is set, every /api/* route (except /api/auth/* and /api/health) is
guarded by the middleware in main.py.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session

from .. import auth, notify
from ..db import get_session
from ..schemas import LoginBody, PasswordBody

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- Brute-force throttle (in-memory, per client IP) ---
# After a few wrong guesses the IP is locked out for a growing cooldown. This is
# a single-container home panel, so a process-local dict is enough; it resets on
# restart (which also clears any lockout — acceptable).
_MAX_FAILS = 5
_LOCK_BASE = 30            # seconds for the first lockout, doubles each time (cap 15m)
_LOGIN_FAILS: dict = {}    # ip -> {"n": fails, "until": monotonic, "strikes": lockouts}


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "?"


def _cookie_secure(request: Request) -> bool:
    """Send Secure cookies only over HTTPS (respecting a TLS reverse proxy).

    Plain-HTTP LAN installs would drop a Secure cookie, breaking login — so we
    key off the actual scheme / X-Forwarded-Proto instead of forcing it."""
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto == "https"


@router.get("/status")
def status(request: Request, session: Session = Depends(get_session)):
    s = notify.get_settings(session)
    enabled = bool(s.panel_password_hash)
    authed = (not enabled) or auth.valid_session(request.cookies.get(auth.COOKIE_NAME, ""), s.panel_password_hash)
    return {"enabled": enabled, "authed": authed}


@router.post("/login")
def login(payload: LoginBody, request: Request, response: Response,
          session: Session = Depends(get_session)):
    ip = _client_ip(request)
    now = time.monotonic()
    rec = _LOGIN_FAILS.get(ip)
    if rec and rec["until"] > now:
        wait = int(rec["until"] - now) + 1
        raise HTTPException(429, f"Çok fazla hatalı deneme. {wait} sn sonra tekrar deneyin.")

    s = notify.get_settings(session)
    if not s.panel_password_hash:
        raise HTTPException(400, "Panel şifresi ayarlı değil")
    if not auth.verify_password(payload.password, s.panel_password_hash):
        rec = _LOGIN_FAILS.setdefault(ip, {"n": 0, "until": 0.0, "strikes": 0})
        rec["n"] += 1
        if rec["n"] >= _MAX_FAILS:
            rec["strikes"] += 1
            rec["until"] = now + min(_LOCK_BASE * (2 ** (rec["strikes"] - 1)), 900)
            rec["n"] = 0
        raise HTTPException(401, "Şifre yanlış")

    _LOGIN_FAILS.pop(ip, None)  # clean slate on success
    response.set_cookie(
        auth.COOKIE_NAME, auth.make_session(s.panel_password_hash),
        httponly=True, samesite="lax", secure=_cookie_secure(request),
        max_age=auth.SESSION_TTL,
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
    logged_in = auth.valid_session(request.cookies.get(auth.COOKIE_NAME, ""), s.panel_password_hash)
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

    if len(new) < 8:
        raise HTTPException(400, "Şifre en az 8 karakter olmalı")
    s.panel_password_hash = auth.hash_password(new)
    session.add(s)
    session.commit()
    response.set_cookie(
        auth.COOKIE_NAME, auth.make_session(s.panel_password_hash),
        httponly=True, samesite="lax", secure=_cookie_secure(request),
        max_age=auth.SESSION_TTL,
    )
    return {"ok": True, "enabled": True}
