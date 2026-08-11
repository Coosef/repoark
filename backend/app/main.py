"""FastAPI application: API + embedded single-page panel.

One container serves everything. API routes live under /api/*; every other
path serves the built React panel (with SPA fallback to index.html).
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, db, scheduler
from .models import Settings
from .routers import accounts, browse, content, destinations, jobs, runs, settings
from .routers import auth as auth_router

log = logging.getLogger("repoark")

# The frontend build is copied here in the Docker image (see Dockerfile).
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# Baked in at image build time (--build-arg APP_VERSION); shown in the panel so
# users can see at a glance which version is running after an update.
APP_VERSION = os.environ.get("APP_VERSION", "dev")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    # Loud warning when the panel is left open (no password). On a LAN, an open
    # panel exposes backups and can trigger token-authenticated actions.
    try:
        with db.new_session() as s:
            row = s.get(Settings, 1)
            if not (row and row.panel_password_hash):
                log.warning(
                    "SECURITY: panel has NO password set — the API is open to "
                    "anyone who can reach this port. Set a password in Settings.")
    except Exception:
        pass
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown()


app = FastAPI(title="GitHub Backup Panel", version=APP_VERSION, lifespan=lifespan)


# --- Panel access protection ---
# When a panel password is configured, every API call (except auth + health)
# must carry a valid session cookie. When no password is set, the panel is open.
_OPEN_PATHS = ("/api/auth/", "/api/health")


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not any(path.startswith(p) for p in _OPEN_PATHS):
        with db.new_session() as s:
            row = s.get(Settings, 1)
            locked = bool(row and row.panel_password_hash)
        if locked and not auth.valid_session(request.cookies.get(auth.COOKIE_NAME, ""), row.panel_password_hash):
            return JSONResponse({"detail": "Giriş gerekli"}, status_code=401)
    return await call_next(request)


# --- Security headers ---
# Applied to every response (added after require_login so it wraps it and 401s
# get the headers too). The CSP allows the SPA's own hashed assets and same-origin
# XHR, permits inline styles (React style props + rendered README), and allows
# https/data images so README badges (shields.io, etc.) still render — but blocks
# inline/remote scripts, framing, and plugins, which neutralizes a hostile README.
_CSP = (
    "default-src 'self'; "
    "img-src 'self' data: https:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "connect-src 'self'; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", _CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


app.include_router(auth_router.router)
app.include_router(accounts.router)
app.include_router(browse.router)
app.include_router(content.router)
app.include_router(destinations.router)
app.include_router(jobs.router)
app.include_router(runs.router)
app.include_router(settings.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": APP_VERSION}


# --- Update check ---
# Compares the running version against the VERSION file on the repo's main
# branch. The only thing sent out is a plain GET for a public file — no telemetry
# or user data. Result is cached so we hit GitHub at most a few times a day, and
# any failure (offline, rate limit) is swallowed so it never disrupts the panel.
_VERSION_URL = "https://raw.githubusercontent.com/Coosef/repoark/main/VERSION"
_REPO_URL = "https://github.com/Coosef/repoark"
# Once an hour is plenty for a "new version available" nudge and keeps the
# panel from pinging GitHub on every page load.
_UPDATE_TTL = timedelta(hours=1)
_update_cache: dict = {"at": None, "latest": None}


def _parse_ver(v: str) -> tuple[int, ...]:
    out = []
    for part in (v or "").strip().split("."):
        try:
            out.append(int(part))
        except ValueError:
            out.append(0)
    return tuple(out) or (0,)


def _latest_version() -> str | None:
    now = datetime.now(timezone.utc)
    at, latest = _update_cache["at"], _update_cache["latest"]
    if at and latest and now - at < _UPDATE_TTL:
        return latest
    try:
        r = httpx.get(_VERSION_URL, timeout=6.0, headers={"User-Agent": "repoark"})
        r.raise_for_status()
        latest = (r.text.strip().split() or [""])[0]
        if latest:
            _update_cache.update(at=now, latest=latest)
        return latest or _update_cache["latest"]
    except Exception:
        return _update_cache["latest"]  # last known, or None on first failure


@app.get("/api/update-check")
def update_check():
    latest = _latest_version()
    available = bool(
        latest and APP_VERSION not in ("", "dev")
        and _parse_ver(latest) > _parse_ver(APP_VERSION)
    )
    return {
        "current": APP_VERSION,
        "latest": latest,
        "update_available": available,
        "url": _REPO_URL,
    }


# --- Static frontend (mounted last so /api/* wins) ---
if (STATIC_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    # Serve real files that live at the static root (manifest, service worker,
    # icons, favicon) directly; everything else falls back to the SPA shell.
    # index.html and the service worker must always be revalidated so app
    # updates reach users without manual cache clearing; hashed assets under
    # /assets keep their default (immutable) caching.
    no_cache = {"Cache-Control": "no-cache"}
    if full_path:
        target = (STATIC_DIR / full_path).resolve()
        if str(target).startswith(str(STATIC_DIR.resolve())) and target.is_file():
            headers = no_cache if target.name == "sw.js" else None
            return FileResponse(target, headers=headers)
    index = STATIC_DIR / "index.html"
    if index.is_file():
        return FileResponse(index, headers=no_cache)
    return {"detail": "Frontend not built. Run the Vite dev server or build the image."}
