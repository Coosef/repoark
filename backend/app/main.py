"""FastAPI application: API + embedded single-page panel.

One container serves everything. API routes live under /api/*; every other
path serves the built React panel (with SPA fallback to index.html).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, db, scheduler
from .models import Settings
from .routers import accounts, browse, content, destinations, jobs, runs, settings
from .routers import auth as auth_router

# The frontend build is copied here in the Docker image (see Dockerfile).
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown()


app = FastAPI(title="GitHub Backup Panel", version="0.1.0", lifespan=lifespan)


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
        if locked and not auth.valid_session(request.cookies.get(auth.COOKIE_NAME, "")):
            return JSONResponse({"detail": "Giriş gerekli"}, status_code=401)
    return await call_next(request)


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
    return {"status": "ok"}


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
