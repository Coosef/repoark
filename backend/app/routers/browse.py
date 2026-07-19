"""Browse *into* the backups like on GitHub: file tree, file view, versions
(branches / tags / commits), and downloads (whole repo at a version, single
file, or a metadata snapshot as a zip).

Repos are stored as bare git mirrors at
    <username>/current/repositories/<repo>/repository
so everything here is served straight from git via `git --git-dir`.
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlmodel import Session
from starlette.background import BackgroundTask

from .. import config, crypto, github
from ..db import get_session
from ..models import Account
from ..schemas import RestoreBody

router = APIRouter(prefix="/api/accounts", tags=["browse"])

_SAFE_NAME = re.compile(r"^[\w.\-]+$")          # repo / snapshot dir names
_SAFE_REF = re.compile(r"^[\w./\-]+$")           # branch / tag / sha
_BLOB_MAX = 1_000_000                            # bytes shown inline


def _account(account_id: int, session: Session) -> Account:
    acc = session.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    return acc


def _git_dir(acc: Account, repo: str) -> Path:
    if not _SAFE_NAME.match(repo):
        raise HTTPException(400, "Invalid repository name")
    base = config.BACKUPS_DIR / acc.username / "current" / "repositories"
    gd = base / repo / "repository"
    if not gd.is_dir():
        raise HTTPException(404, "Repository not found in backup")
    return gd


def _check_ref(ref: str) -> str:
    if not ref or ref.startswith("-") or not _SAFE_REF.match(ref):
        raise HTTPException(400, "Invalid ref")
    return ref


def _check_path(path: str) -> str:
    path = (path or "").lstrip("/")
    if ".." in path.split("/"):
        raise HTTPException(400, "Invalid path")
    return path


def _git(gd: Path, *args: str, binary: bool = False):
    r = subprocess.run(
        ["git", f"--git-dir={gd}", *args],
        capture_output=True, timeout=60,
    )
    if r.returncode != 0:
        msg = r.stderr.decode(errors="replace").strip()
        raise HTTPException(400, msg or "git error")
    return r.stdout if binary else r.stdout.decode(errors="replace")


@router.get("/{account_id}/repos/{repo}/refs")
def refs(account_id: int, repo: str, session: Session = Depends(get_session)):
    gd = _git_dir(_account(account_id, session), repo)
    heads = _git(gd, "for-each-ref", "--format=%(refname:short)", "refs/heads").split()
    tags = _git(gd, "for-each-ref", "--format=%(refname:short)", "refs/tags").split()
    try:
        head = _git(gd, "symbolic-ref", "--short", "HEAD").strip()
    except HTTPException:
        head = heads[0] if heads else "HEAD"
    return {"head": head, "branches": heads, "tags": tags}


_README_NAMES = {"readme.md", "readme", "readme.rst", "readme.txt", "readme.markdown"}


@router.get("/{account_id}/repos/{repo}/overview")
def overview(account_id: int, repo: str, session: Session = Depends(get_session)):
    """GitHub-like project overview: metadata + git stats + README location."""
    acc = _account(account_id, session)
    gd = _git_dir(acc, repo)

    meta: dict = {}
    repos_json = config.BACKUPS_DIR / acc.username / "current" / "account" / "repos.json"
    try:
        for r in json.loads(repos_json.read_text()):
            if r.get("name") == repo:
                meta = r
                break
    except Exception:
        pass

    heads = _git(gd, "for-each-ref", "--format=%(refname:short)", "refs/heads").split()
    tags = _git(gd, "for-each-ref", "--format=%(refname:short)", "refs/tags").split()
    try:
        head = _git(gd, "symbolic-ref", "--short", "HEAD").strip()
    except HTTPException:
        head = heads[0] if heads else "HEAD"

    try:
        commits = int(_git(gd, "rev-list", "--count", head).strip())
    except (HTTPException, ValueError):
        commits = 0

    last_commit = None
    try:
        parts = _git(gd, "log", "-1", "--format=%H%x1f%an%x1f%ad%x1f%s",
                     "--date=iso", head).strip().split("\x1f")
        if len(parts) == 4:
            last_commit = {"sha": parts[0], "author": parts[1], "date": parts[2], "message": parts[3]}
    except HTTPException:
        pass

    readme = None
    try:
        for name in _git(gd, "ls-tree", "--name-only", head).splitlines():
            if name.lower() in _README_NAMES:
                readme = name
                break
    except HTTPException:
        pass

    return {
        "name": repo, "meta": meta, "default_branch": head,
        "branches": len(heads), "tags": len(tags), "commits": commits,
        "last_commit": last_commit, "readme": readme,
    }


@router.get("/{account_id}/repos/{repo}/tree")
def tree(account_id: int, repo: str, ref: str = Query("HEAD"), path: str = Query(""),
         session: Session = Depends(get_session)):
    gd = _git_dir(_account(account_id, session), repo)
    _check_ref(ref)
    path = _check_path(path)
    spec = f"{ref}:{path}" if path else ref
    out = _git(gd, "ls-tree", "-l", spec)
    entries = []
    for line in out.splitlines():
        # "<mode> <type> <sha> <size>\t<name>"
        meta, _, name = line.partition("\t")
        parts = meta.split()
        if len(parts) < 4:
            continue
        _, typ, _, size = parts[0], parts[1], parts[2], parts[3]
        entries.append({
            "name": name,
            "type": "dir" if typ == "tree" else "file",
            "size": None if size == "-" else int(size),
        })
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return {"ref": ref, "path": path, "entries": entries}


@router.get("/{account_id}/repos/{repo}/blob")
def blob(account_id: int, repo: str, ref: str = Query("HEAD"), path: str = Query(...),
         session: Session = Depends(get_session)):
    gd = _git_dir(_account(account_id, session), repo)
    _check_ref(ref)
    path = _check_path(path)
    if not path:
        raise HTTPException(400, "path required")
    data = _git(gd, "show", f"{ref}:{path}", binary=True)
    is_binary = b"\x00" in data[:8000]
    truncated = len(data) > _BLOB_MAX
    if is_binary:
        return {"binary": True, "size": len(data), "text": None, "truncated": False}
    return {
        "binary": False,
        "size": len(data),
        "truncated": truncated,
        "text": data[:_BLOB_MAX].decode(errors="replace"),
    }


@router.get("/{account_id}/repos/{repo}/commits")
def commits(account_id: int, repo: str, ref: str = Query("HEAD"),
            limit: int = Query(50, le=200), session: Session = Depends(get_session)):
    gd = _git_dir(_account(account_id, session), repo)
    _check_ref(ref)
    out = _git(gd, "log", f"--format=%H%x1f%an%x1f%ad%x1f%s", "--date=iso",
               f"-n{limit}", ref)
    rows = []
    for line in out.splitlines():
        p = line.split("\x1f")
        if len(p) == 4:
            rows.append({"sha": p[0], "author": p[1], "date": p[2], "message": p[3]})
    return rows


@router.get("/{account_id}/repos/{repo}/raw")
def raw(account_id: int, repo: str, ref: str = Query("HEAD"), path: str = Query(...),
        session: Session = Depends(get_session)):
    gd = _git_dir(_account(account_id, session), repo)
    _check_ref(ref)
    path = _check_path(path)
    if not path:
        raise HTTPException(400, "path required")
    data = _git(gd, "show", f"{ref}:{path}", binary=True)
    fname = path.rsplit("/", 1)[-1]
    return Response(content=data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/{account_id}/repos/{repo}/download")
def download_repo(account_id: int, repo: str, ref: str = Query("HEAD"),
                  session: Session = Depends(get_session)):
    gd = _git_dir(_account(account_id, session), repo)
    _check_ref(ref)
    proc = subprocess.Popen(
        ["git", f"--git-dir={gd}", "archive", "--format=zip", f"--prefix={repo}/", ref],
        stdout=subprocess.PIPE,
    )

    def _stream():
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            proc.wait()

    return StreamingResponse(
        _stream(), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{repo}-{ref}.zip"'},
    )


@router.get("/{account_id}/repos/{repo}/bundle")
def repo_bundle(account_id: int, repo: str, session: Session = Depends(get_session)):
    """A single-file git bundle of all refs — restore with `git clone x.bundle`."""
    gd = _git_dir(_account(account_id, session), repo)
    proc = subprocess.Popen(
        ["git", f"--git-dir={gd}", "bundle", "create", "-", "--all"],
        stdout=subprocess.PIPE)

    def _stream():
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            proc.wait()

    return StreamingResponse(_stream(), media_type="application/octet-stream",
                             headers={"Content-Disposition": f'attachment; filename="{repo}.bundle"'})


@router.post("/{account_id}/repos/{repo}/restore")
def restore_repo(account_id: int, repo: str, payload: RestoreBody,
                 session: Session = Depends(get_session)):
    """Recreate a backed-up repo directly on GitHub (create + mirror-push).

    Useful when a repo was deleted on GitHub: this pushes the local bare mirror
    back up into a fresh repository. Needs a token with repo-creation scope.
    """
    acc = _account(account_id, session)
    gd = _git_dir(acc, repo)
    new_name = (payload.new_name or repo).strip()
    if not _SAFE_NAME.match(new_name):
        raise HTTPException(400, "Geçersiz repo adı")

    token = crypto.decrypt(acc.token_enc)
    org = acc.username if acc.is_org else ""
    try:
        created = github.create_repo(token, new_name, private=payload.private, org=org)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 422:
            raise HTTPException(409, "Bu isimde bir repo GitHub'da zaten var")
        if e.response.status_code in (401, 403):
            raise HTTPException(400, "Token bu işlem için yetkili değil (repo oluşturma izni gerekli)")
        raise HTTPException(502, f"GitHub error: {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"GitHub'a ulaşılamadı: {e}")

    owner = created.get("owner", {}).get("login", org or acc.username)
    remote = f"https://{token}@github.com/{owner}/{new_name}.git"
    r = subprocess.run(
        ["git", f"--git-dir={gd}", "push", "--mirror", remote],
        capture_output=True, timeout=1800,
        env=dict(os.environ, GIT_TERMINAL_PROMPT="0"),
    )
    if r.returncode != 0:
        msg = r.stderr.decode(errors="replace").replace(token, "***").strip()
        raise HTTPException(400, msg or "git push başarısız")
    return {"ok": True, "html_url": created.get("html_url"),
            "full_name": created.get("full_name", f"{owner}/{new_name}")}


# ---- Search across all repos in an account ----

def _git_optional(gd: Path, *args: str) -> tuple[int, str]:
    """Like _git but returns (code, output) without raising (for grep)."""
    r = subprocess.run(["git", f"--git-dir={gd}", *args], capture_output=True, timeout=60)
    return r.returncode, r.stdout.decode(errors="replace")


@router.get("/{account_id}/search")
def search(account_id: int, q: str = Query(..., min_length=2),
           mode: str = Query("filename"), limit: int = Query(200, le=1000),
           session: Session = Depends(get_session)):
    """Search file names or code content across every backed-up repo."""
    acc = _account(account_id, session)
    repos = config.BACKUPS_DIR / acc.username / "current" / "repositories"
    if not repos.is_dir():
        return {"results": [], "truncated": False}
    results: list[dict] = []
    ql = q.lower()
    for repo_dir in sorted(repos.iterdir()):
        gd = repo_dir / "repository"
        if not gd.is_dir():
            continue
        if mode == "content":
            code, out = _git_optional(gd, "grep", "-n", "-i", "-I", "-e", q, "HEAD")
            if code not in (0, 1):
                continue
            for line in out.splitlines():
                parts = line.split(":", 3)  # HEAD:path:lineno:text
                if len(parts) == 4:
                    results.append({"repo": repo_dir.name, "path": parts[1],
                                    "line": parts[2], "text": parts[3][:200]})
                    if len(results) >= limit:
                        return {"results": results, "truncated": True}
        else:  # filename
            code, out = _git_optional(gd, "ls-tree", "-r", "--name-only", "HEAD")
            if code != 0:
                continue
            for path in out.splitlines():
                if ql in path.lower():
                    results.append({"repo": repo_dir.name, "path": path})
                    if len(results) >= limit:
                        return {"results": results, "truncated": True}
    return {"results": results, "truncated": False}


# ---- Gist content browsing (gists are bare git repos too) ----

def _gist_git_dir(acc: Account, gid: str) -> Path:
    if not _SAFE_NAME.match(gid):
        raise HTTPException(400, "Invalid gist id")
    gd = config.BACKUPS_DIR / acc.username / "current" / "gists" / gid / "repository"
    if not gd.is_dir():
        raise HTTPException(404, "Gist not found in backup")
    return gd


@router.get("/{account_id}/gists/{gid}/tree")
def gist_tree(account_id: int, gid: str, ref: str = Query("HEAD"), path: str = Query(""),
              session: Session = Depends(get_session)):
    gd = _gist_git_dir(_account(account_id, session), gid)
    _check_ref(ref)
    path = _check_path(path)
    spec = f"{ref}:{path}" if path else ref
    out = _git(gd, "ls-tree", "-l", spec)
    entries = []
    for line in out.splitlines():
        meta, _, name = line.partition("\t")
        parts = meta.split()
        if len(parts) >= 4:
            entries.append({"name": name, "type": "dir" if parts[1] == "tree" else "file",
                            "size": None if parts[3] == "-" else int(parts[3])})
    entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
    return {"ref": ref, "path": path, "entries": entries}


@router.get("/{account_id}/gists/{gid}/blob")
def gist_blob(account_id: int, gid: str, ref: str = Query("HEAD"), path: str = Query(...),
              session: Session = Depends(get_session)):
    gd = _gist_git_dir(_account(account_id, session), gid)
    _check_ref(ref)
    path = _check_path(path)
    data = _git(gd, "show", f"{ref}:{path}", binary=True)
    if b"\x00" in data[:8000]:
        return {"binary": True, "size": len(data), "text": None, "truncated": False}
    return {"binary": False, "size": len(data), "truncated": len(data) > _BLOB_MAX,
            "text": data[:_BLOB_MAX].decode(errors="replace")}


@router.get("/{account_id}/gists/{gid}/download")
def gist_download(account_id: int, gid: str, ref: str = Query("HEAD"),
                  session: Session = Depends(get_session)):
    gd = _gist_git_dir(_account(account_id, session), gid)
    _check_ref(ref)
    proc = subprocess.Popen(
        ["git", f"--git-dir={gd}", "archive", "--format=zip", f"--prefix=gist-{gid}/", ref],
        stdout=subprocess.PIPE)

    def _stream():
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            proc.wait()

    return StreamingResponse(_stream(), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="gist-{gid}.zip"'})


# ---- Issues & pull requests (readable view of the JSON backup) ----

def _kind_dir(acc: Account, repo: str, kind: str) -> Path:
    if not _SAFE_NAME.match(repo) or kind not in ("issues", "pulls"):
        raise HTTPException(400, "Invalid request")
    return config.BACKUPS_DIR / acc.username / "current" / "repositories" / repo / kind


def _login(obj) -> str | None:
    return obj.get("login") if isinstance(obj, dict) else None


@router.get("/{account_id}/repos/{repo}/{kind}")
def list_threads(account_id: int, repo: str, kind: str,
                 session: Session = Depends(get_session)):
    """List issues or pulls (kind = 'issues' | 'pulls')."""
    d = _kind_dir(_account(account_id, session), repo, kind)
    if not d.is_dir():
        return []
    rows = []
    for f in d.glob("*.json"):
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue
        rows.append({
            "number": data.get("number"),
            "title": data.get("title"),
            "state": data.get("state"),
            "user": _login(data.get("user")),
            "comments": data.get("comments", 0),
            "created_at": data.get("created_at"),
        })
    rows.sort(key=lambda r: r["number"] or 0, reverse=True)
    return rows


@router.get("/{account_id}/repos/{repo}/{kind}/{number}")
def thread_detail(account_id: int, repo: str, kind: str, number: int,
                  session: Session = Depends(get_session)):
    d = _kind_dir(_account(account_id, session), repo, kind)
    f = d / f"{number}.json"
    if not f.is_file():
        raise HTTPException(404, "Not found")
    data = json.loads(f.read_text())
    comments = []
    for c in (data.get("comment_data") or []):
        if isinstance(c, dict):
            comments.append({
                "user": _login(c.get("user")),
                "body": c.get("body"),
                "created_at": c.get("created_at"),
            })
    return {
        "number": data.get("number"),
        "title": data.get("title"),
        "state": data.get("state"),
        "user": _login(data.get("user")),
        "body": data.get("body"),
        "created_at": data.get("created_at"),
        "closed_at": data.get("closed_at"),
        "html_url": data.get("html_url"),
        "labels": [l.get("name") for l in (data.get("labels") or []) if isinstance(l, dict)],
        "comments": comments,
    }


# ---- Restore helpers: whole-account zip (repo bundle is defined earlier) ----

@router.get("/{account_id}/download")
def account_download(account_id: int, session: Session = Depends(get_session)):
    """Zip the entire account backup (repos + metadata) for offline restore."""
    acc = _account(account_id, session)
    cur = config.BACKUPS_DIR / acc.username / "current"
    if not cur.is_dir():
        raise HTTPException(404, "Bu hesap için yedek yok")
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as z:
        for p in cur.rglob("*"):
            if p.is_file():
                z.write(p, arcname=str(p.relative_to(cur)))
    return FileResponse(
        tmp.name, filename=f"{acc.username}-yedek.zip", media_type="application/zip",
        background=BackgroundTask(os.unlink, tmp.name),
    )


# ---- Snapshots (metadata version history) ----

def _snap_dir(acc: Account, name: str) -> Path:
    if not _SAFE_NAME.match(name):
        raise HTTPException(400, "Invalid snapshot name")
    d = config.BACKUPS_DIR / acc.username / "snapshots" / name
    if not d.is_dir():
        raise HTTPException(404, "Snapshot not found")
    return d


@router.get("/{account_id}/snapshots/{name}/detail")
def snapshot_detail(account_id: int, name: str, session: Session = Depends(get_session)):
    d = _snap_dir(_account(account_id, session), name)
    files = []
    for p in sorted(d.rglob("*")):
        if p.is_file():
            files.append({"path": str(p.relative_to(d)), "size": p.stat().st_size})
    return {"name": name, "files": files, "count": len(files)}


@router.get("/{account_id}/snapshots/{name}/file")
def snapshot_file(account_id: int, name: str, path: str = Query(...),
                  session: Session = Depends(get_session)):
    d = _snap_dir(_account(account_id, session), name)
    path = _check_path(path)
    fp = (d / path).resolve()
    if not str(fp).startswith(str(d.resolve())) or not fp.is_file():
        raise HTTPException(404, "File not found")
    data = fp.read_bytes()
    truncated = len(data) > _BLOB_MAX
    return {"path": path, "size": len(data), "truncated": truncated,
            "text": data[:_BLOB_MAX].decode(errors="replace")}


@router.get("/{account_id}/snapshots/{name}/download")
def snapshot_download(account_id: int, name: str, session: Session = Depends(get_session)):
    d = _snap_dir(_account(account_id, session), name)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in d.rglob("*"):
            if p.is_file():
                z.write(p, arcname=str(p.relative_to(d)))
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="snapshot-{name}.zip"'},
    )
