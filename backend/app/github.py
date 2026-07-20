"""GitHub API helpers: token validation and change-detection fingerprints.

The panel uses the REST API only to (a) verify a token and resolve its login,
and (b) cheaply decide whether anything changed since the last backup. The
heavy lifting of actually downloading repos/metadata is done by the
`github-backup` engine (see engine.py).
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from . import config

_HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github-backup-panel",
}


def _client(token: str) -> httpx.Client:
    headers = dict(_HEADERS_BASE)
    headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(base_url=config.GITHUB_API, headers=headers, timeout=30.0)


def validate_token(token: str) -> dict[str, Any]:
    """Return the authenticated user object, or raise on invalid token."""
    with _client(token) as c:
        r = c.get("/user")
        r.raise_for_status()
        return r.json()


def validate_org(token: str, org: str) -> dict[str, Any]:
    """Return the organization object, or raise if inaccessible."""
    with _client(token) as c:
        r = c.get(f"/orgs/{org}")
        r.raise_for_status()
        return r.json()


def _parse_expiry(val: str) -> Optional[datetime]:
    """Parse GitHub's token-expiration header into a naive-UTC datetime.

    The header looks like "2026-08-01 15:30:00 UTC" or "... -0700"; tokens that
    do not expire omit the header entirely (we return None).
    """
    val = (val or "").strip()
    if not val:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d %H:%M:%S %z"):
        try:
            dt = datetime.strptime(val, fmt)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except ValueError:
            continue
    return None


def token_expiry(token: str) -> Optional[datetime]:
    """Best-effort: return when the token expires (naive-UTC), or None.

    None means either the token never expires or the check failed — callers
    treat it as "no known expiry" and never fail because of it.
    """
    try:
        with _client(token) as c:
            r = c.get("/user")
            r.raise_for_status()
            return _parse_expiry(r.headers.get("github-authentication-token-expiration", ""))
    except Exception:
        return None


def create_repo(token: str, name: str, *, private: bool = True,
                org: str = "", description: str = "") -> dict[str, Any]:
    """Create a new repository on GitHub (for restoring a backup back up).

    Creates under the user account, or under `org` when given. Raises on error
    (e.g. 422 if a repo with that name already exists).
    """
    payload: dict[str, Any] = {"name": name, "private": private, "auto_init": False}
    if description:
        payload["description"] = description
    with _client(token) as c:
        path = f"/orgs/{org}/repos" if org else "/user/repos"
        r = c.post(path, json=payload)
        r.raise_for_status()
        return r.json()


def _paginate(c: httpx.Client, path: str, params: dict | None = None,
              max_pages: int = 50) -> list[dict]:
    """Follow Link-header pagination up to a sane cap."""
    items: list[dict] = []
    params = dict(params or {})
    params.setdefault("per_page", 100)
    url: str | None = path
    page = 0
    while url and page < max_pages:
        r = c.get(url, params=params if page == 0 else None)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            items.extend(data)
        url = r.links.get("next", {}).get("url")
        page += 1
    return items


def list_starred(token: str) -> list[dict[str, Any]]:
    """Live list of the user's starred repos, for the job's selection picker."""
    with _client(token) as c:
        rows = _paginate(c, "/user/starred", {"sort": "created"})
    return [
        {
            "full_name": r.get("full_name"),
            "description": r.get("description"),
            "language": r.get("language"),
            "stars": r.get("stargazers_count"),
            "private": r.get("private"),
        }
        for r in rows if r.get("full_name")
    ]


def _hash(obj: Any) -> str:
    blob = json.dumps(obj, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def compute_fingerprint(token: str, *, repos: bool, private: bool, forks: bool,
                        issues: bool, starred: bool, gists: bool,
                        profile: bool = True, org: str = ""
                        ) -> tuple[dict[str, str], dict[str, int], list[dict]]:
    """Build a per-category fingerprint + counts + repo metadata.

    Comparing the fingerprint against the one stored from the last run tells us,
    without downloading anything, which categories (if any) actually changed.
    Issues live inside repos, so they ride on the repo fingerprint. Counts feed
    the live progress total; repo metadata feeds the dashboard insights. When
    `org` is set the repos come from that organization and the user-scoped
    categories (starred/gists/profile) are skipped.
    """
    fp: dict[str, str] = {}
    counts: dict[str, int] = {"repos": 0, "starred": 0, "gists": 0}
    repos_meta: list[dict] = []
    with _client(token) as c:
        if repos or issues:
            if org:
                rows = _paginate(c, f"/orgs/{org}/repos", {"sort": "pushed", "type": "all"})
            else:
                rows = _paginate(c, "/user/repos", {"affiliation": "owner", "sort": "pushed"})
            selected = [
                r for r in rows
                if (private or not r.get("private")) and (forks or not r.get("fork"))
            ]
            sig = {r["full_name"]: r.get("pushed_at") for r in selected}
            fp["repos"] = _hash(sig)
            counts["repos"] = len(selected)
            repos_meta = [
                {
                    "name": r.get("name"),
                    "full_name": r.get("full_name"),
                    "language": r.get("language"),
                    "private": r.get("private"),
                    "fork": r.get("fork"),
                    "archived": r.get("archived"),
                    "stars": r.get("stargazers_count"),
                    "size": r.get("size"),
                    "pushed_at": r.get("pushed_at"),
                    "description": r.get("description"),
                }
                for r in selected
            ]

        if starred and not org:
            rows = _paginate(c, "/user/starred", {"sort": "created"})
            fp["starred"] = _hash([r["full_name"] for r in rows])
            counts["starred"] = len(rows)

        if gists and not org:
            rows = _paginate(c, "/gists")
            fp["gists"] = _hash({g["id"]: g.get("updated_at") for g in rows})
            counts["gists"] = len(rows)

        if profile and not org:
            u = c.get("/user").json()
            keep = {k: u.get(k) for k in (
                "login", "name", "bio", "company", "blog", "location",
                "public_repos", "public_gists", "followers", "following",
            )}
            fp["profile"] = _hash(keep)

    return fp, counts, repos_meta


def fetch_profile_bundle(token: str) -> dict[str, Any]:
    """Fetch profile + social graph as JSON.

    github-backup focuses on repos/issues/gists; we capture the account's own
    profile, followers and following directly so the "Profile & social" scope
    is guaranteed regardless of engine flag support.

    The profile itself is always captured. Followers/following are best-effort:
    fine-grained tokens without the "Followers" permission get 403 there, so we
    record a note and continue instead of failing the whole profile step.
    """
    notes: list[str] = []
    with _client(token) as c:
        user = c.get("/user").json()

        def _social(path: str) -> list[str]:
            try:
                return [u["login"] for u in _paginate(c, path)]
            except httpx.HTTPError as e:
                notes.append(f"{path}: {e}")
                return []

        followers = _social("/user/followers")
        following = _social("/user/following")

    return {"user": user, "followers": followers, "following": following, "notes": notes}


def diff_fingerprints(old: dict[str, str], new: dict[str, str]) -> list[str]:
    """Return the list of categories that changed (or are new)."""
    changed = []
    for key, val in new.items():
        if old.get(key) != val:
            changed.append(key)
    return changed
