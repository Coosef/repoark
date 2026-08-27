"""Secret/credential scanning of backed-up repositories.

Backups routinely contain the one thing that should never be in a repo: a
committed .env, an API key, a password in a config file. This module scans the
user's OWN backed-up mirrors (never third-party starred clones — those would
drown the report in other people's noise) and reports likely leaks so the
dashboard can warn.

Design:
  * One fast `git grep` per repo (coarse pre-filter, no checkout needed on the
    bare mirror), then precise classification in Python — so a repo scan is
    milliseconds, not a working-tree walk.
  * Findings are cached per repo keyed on its HEAD commit; unchanged repos are
    not rescanned on the post-backup pass.
  * The matched secret itself is NEVER stored or returned — only a masked
    preview (first characters + length), so the scan report is not itself a
    secret dump.
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
from pathlib import Path

from . import config

# --- Precise patterns (Python re). kind -> (regex, group label) ---
# label groups the kinds for the UI: key = API/service key, pkey = private key,
# pass = password-ish, file = risky filename.
_PATTERNS: list[tuple[str, str, re.Pattern]] = [
    ("aws_key", "key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", "key", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b")),
    ("gitlab_token", "key", re.compile(r"\bglpat-[A-Za-z0-9_\-]{20}\b")),
    ("slack_token", "key", re.compile(r"\bxox[baprs]-[A-Za-z0-9][A-Za-z0-9-]{9,}\b")),
    ("google_key", "key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("stripe_key", "key", re.compile(r"\b[sr]k_live_[0-9a-zA-Z]{20,}\b")),
    ("sendgrid_key", "key", re.compile(r"\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{40,}\b")),
    ("openai_key", "key", re.compile(r"\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b|\bsk-proj-[A-Za-z0-9_\-]{60,}\b")),
    ("telegram_bot", "key", re.compile(r"\b\d{8,10}:AA[A-Za-z0-9_\-]{33}\b")),
    ("private_key", "pkey", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----")),
    # URL with an embedded password: scheme://user:pass@host
    ("url_password", "pass", re.compile(r"[a-z][a-z0-9+.\-]{1,12}://[^/\s:@'\"]{1,64}:([^@\s'\"]{3,})@")),
    # password/api_key = value assignments — only meaningful in config-ish
    # files (see _CONFIG_EXT), and only for non-placeholder values. No leading
    # \b: DB_PASSWORD must match. Value may be quoted or bare (.env style).
    ("credential_assign", "pass", re.compile(
        r"(?i)(password|passwd|pwd|secret|secret[_-]?key|api[_-]?key|apikey|"
        r"auth[_-]?token|access[_-]?token|access[_-]?key)\s*[:=]\s*"
        r"(?:[\"']([^\"'\n]{8,80})[\"']|([^\s\"'#;,<>{}\[\]()`]{8,80}))")),
]

# Coarse git-grep pre-filters (POSIX ERE). Precision comes from the Python
# patterns above; these only cut the candidate set. Two passes with different
# blast radius: service-key shapes are rare strings, so they are grepped across
# the whole tree; password/apikey words appear on half the lines of any real
# codebase, so that pass is restricted to config-like files (see _CONFIG_SPECS).
_COARSE_KEYS = (
    "AKIA|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[baprs]-|AIza|"
    "k_live_|SG\\.|T3BlbkFJ|sk-proj-|PRIVATE KEY|[0-9][0-9]{7,9}:AA"
)
_COARSE_CREDS = (
    "(password|passwd|pwd|secret|api[_-]?key|apikey|"
    "auth[_-]?token|access[_-]?token|access[_-]?key)[[:space:]]*[:=]|"
    "://[^/[:space:]]*:[^/[:space:]]*@"
)
# git pathspec fnmatch lets '*' cross '/' — '*.json' matches at any depth.
_CONFIG_SPECS = (".env*", "*/.env*", "*.json", "*.yml", "*.yaml", "*.ini",
                 "*.cfg", "*.conf", "*.toml", "*.properties", "*.tf",
                 "*.tfvars", "*.xml")

# Filenames that should not be in a repo at all, regardless of content.
_RISKY_BASENAMES = {
    ".env", ".netrc", ".pgpass", ".htpasswd", ".npmrc",
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    "credentials.json", "secrets.json", "secrets.yml", "secrets.yaml",
}
_RISKY_SUFFIXES = (".pem", ".p12", ".pfx", ".jks", ".keystore", ".ppk")
# .env.example / .env.sample etc. are templates, not leaks.
_ENV_TEMPLATE = re.compile(r"^\.env\.(example|sample|template|dist|test)$", re.I)

# credential_assign only fires in files where a quoted literal is likely real
# config, not source-code noise.
_CONFIG_EXT = (".env", ".json", ".yml", ".yaml", ".ini", ".cfg", ".conf",
               ".toml", ".properties", ".tf", ".tfvars", ".xml")

# Vendored / generated paths produce endless third-party noise.
_NOISE_DIRS = ("node_modules/", "vendor/", "dist/", "build/", ".yarn/",
               "bower_components/", "site-packages/")
_NOISE_FILES = ("package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                "composer.lock", "Cargo.lock", "poetry.lock")
_NOISE_SUFFIXES = (".min.js", ".min.css", ".map", ".svg", ".lock", ".sum",
                   ".mmdb", ".ipynb")

# Obvious placeholder values must not be flagged as leaked credentials.
_PLACEHOLDER_HINTS = ("example", "sample", "changeme", "change_me", "change-me",
                      "placeholder", "your_", "your-", "yourpassword", "dummy",
                      "insert", "redacted", "xxxx", "****", "<", ">", "${",
                      "{{", "%(", "process.env", "os.environ", "getenv",
                      "askpass", "keychain")
_PLACEHOLDER_EXACT = {"password", "passw0rd", "password1", "password123",
                      "secret", "secretkey", "admin", "admin123", "test",
                      "testtest", "testing", "null", "none", "true", "false",
                      "undefined", "not_set", "notset", "empty", "string",
                      "hunter2", "12345678", "123456789", "1234567890"}

_MAX_FINDINGS_PER_REPO = 50
_MAX_CANDIDATE_LINES = 4000     # stop parsing grep output beyond this (noise cap)
_MAX_LINE_CHARS = 4000          # minified lines: classify only the head
_SCAN_FILE = "secret_scan.json"

_scan_lock = threading.Lock()


def _mask(secret: str) -> str:
    """A safe preview: a few leading characters + the length. Never the value."""
    head = secret[:4]
    return f"{head}…({len(secret)} kr)"


def _is_placeholder(value: str) -> bool:
    v = value.strip().strip("'\"").lower()
    if not v or v in _PLACEHOLDER_EXACT:
        return True
    if v.startswith(("$", "%")):     # $DB_PASS / %PASS% — a variable, not a value
        return True
    return any(h in v for h in _PLACEHOLDER_HINTS)


def _is_noise_path(path: str) -> bool:
    p = path.lower()
    base = p.rsplit("/", 1)[-1]
    return (any(d in p for d in _NOISE_DIRS)
            or base in _NOISE_FILES
            or p.endswith(_NOISE_SUFFIXES))


def _classify_line(path: str, text: str) -> list[dict]:
    """Run the precise patterns over one candidate line; return masked findings."""
    out = []
    text = text[:_MAX_LINE_CHARS]
    base = path.rsplit("/", 1)[-1].lower()
    is_config = path.lower().endswith(_CONFIG_EXT) or base.startswith(".env")
    is_template = bool(_ENV_TEMPLATE.match(base))
    for kind, label, rx in _PATTERNS:
        m = rx.search(text)
        if not m:
            continue
        if kind == "credential_assign":
            value = m.group(2) or m.group(3) or ""
            # Template files (.env.example) hold intentionally fake values.
            if not is_config or is_template or _is_placeholder(value):
                continue
            preview = f"{m.group(1)}={_mask(value)}"
        elif kind == "url_password":
            if is_template or _is_placeholder(m.group(1)):
                continue
            preview = _mask(m.group(0))
        elif kind == "private_key":
            preview = m.group(0)[:40]
        else:
            preview = _mask(m.group(0))
        out.append({"kind": kind, "label": label, "preview": preview})
    return out


def _git(git_dir: Path, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(["git", f"--git-dir={git_dir}", *args],
                          capture_output=True, timeout=timeout)


def scan_repo(git_dir: Path) -> dict:
    """Scan one bare mirror's HEAD tree. Returns {head, findings, truncated}."""
    head_r = _git(git_dir, "rev-parse", "HEAD", timeout=30)
    if head_r.returncode != 0:
        return {"head": None, "findings": [], "truncated": False}   # empty repo
    head = head_r.stdout.decode().strip()

    findings: list[dict] = []
    truncated = False

    # 1) Risky filenames straight from the tree listing (no content needed).
    ls = _git(git_dir, "ls-tree", "-r", "--name-only", "HEAD")
    if ls.returncode == 0:
        for path in ls.stdout.decode(errors="replace").splitlines():
            base = path.rsplit("/", 1)[-1]
            lower = base.lower()
            if _ENV_TEMPLATE.match(lower) or _is_noise_path(path):
                continue
            if (lower in _RISKY_BASENAMES or lower.endswith(_RISKY_SUFFIXES)
                    or lower.startswith(".env.")):
                findings.append({"file": path, "line": None, "kind": "risky_file",
                                 "label": "file", "preview": base})

    # 2) Content: coarse git greps, then precise classification per line.
    candidates: list[str] = []
    for args in (("grep", "-I", "-n", "-E", _COARSE_KEYS, "HEAD"),
                 ("grep", "-I", "-n", "-i", "-E", _COARSE_CREDS, "HEAD",
                  "--", *_CONFIG_SPECS)):
        gr = _git(git_dir, *args)
        if gr.returncode == 0:    # 1 = no matches, >1 = error; both add nothing
            candidates.extend(gr.stdout.decode(errors="replace").splitlines())
    if len(candidates) > _MAX_CANDIDATE_LINES:
        candidates = candidates[:_MAX_CANDIDATE_LINES]
        truncated = True
    seen: set[tuple] = set()
    for raw in candidates:
        if len(findings) >= _MAX_FINDINGS_PER_REPO:
            truncated = True
            break
        parts = raw.split(":", 3)   # HEAD:path:lineno:content
        if len(parts) != 4 or parts[0] != "HEAD":
            continue
        _, path, lineno, content = parts
        if _is_noise_path(path):
            continue
        for f in _classify_line(path, content):
            key = (path, lineno, f["kind"])
            if key in seen:         # the two grep passes can overlap
                continue
            seen.add(key)
            findings.append({"file": path,
                             "line": int(lineno) if lineno.isdigit() else None,
                             **f})

    return {"head": head, "findings": findings[:_MAX_FINDINGS_PER_REPO],
            "truncated": truncated}


def _scan_path(username: str) -> Path:
    return config.BACKUPS_DIR / username / _SCAN_FILE


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def summary_for(username: str) -> dict:
    """The stored summary (cheap — used by the alerts endpoint every poll)."""
    data = _read_json(_scan_path(username), {})
    return data.get("summary") or {"total": 0, "repos_with_findings": 0,
                                   "repos_scanned": 0, "scanned_at": None}


def results_for(username: str, limit: int = 200) -> dict:
    """Stored results flattened for the panel."""
    data = _read_json(_scan_path(username), {})
    rows = []
    for repo, entry in sorted((data.get("repos") or {}).items()):
        for f in entry.get("findings", []):
            rows.append({"repo": repo, **f})
    s = data.get("summary") or {}
    return {
        "scanned_at": s.get("scanned_at"),
        "repos_scanned": s.get("repos_scanned", 0),
        "repos_with_findings": s.get("repos_with_findings", 0),
        "total": s.get("total", len(rows)),
        "truncated": bool(s.get("truncated")) or len(rows) > limit,
        "findings": rows[:limit],
    }


def _own_repo_dirs(username: str) -> list[tuple[str, Path]]:
    """Mirrors to scan: the account's own repos + own gists.

    repositories/ can also hold selected-starred clones; when repos.json (the
    authoritative own-repo list) exists we scan only names on it. Third-party
    code is never this user's leak to fix. current/starred/ is always skipped.
    """
    cur = config.BACKUPS_DIR / username / "current"
    owned = {r.get("name") for r in _read_json(cur / "account" / "repos.json", [])
             if r.get("name")}
    out: list[tuple[str, Path]] = []
    repos_root = cur / "repositories"
    if repos_root.is_dir():
        for d in sorted(repos_root.iterdir()):
            gd = d / "repository"
            if gd.is_dir() and (not owned or d.name in owned):
                out.append((d.name, gd))
    gists_root = cur / "gists"
    if gists_root.is_dir():
        for d in sorted(gists_root.iterdir()):
            gd = d / "repository"
            if gd.is_dir():
                out.append((f"gist:{d.name}", gd))
    return out


def scan_account(username: str, force: bool = False) -> dict:
    """Scan all of the account's own mirrors, reusing cached results for repos
    whose HEAD hasn't moved. Persists to <account>/secret_scan.json and returns
    the flattened results (same shape as results_for)."""
    from .models import utcnow   # local import: models pulls in sqlmodel

    with _scan_lock:
        prev = _read_json(_scan_path(username), {})
        prev_repos = prev.get("repos") or {}
        repos_out: dict[str, dict] = {}
        truncated = False

        for name, git_dir in _own_repo_dirs(username):
            cached = prev_repos.get(name)
            if cached and not force:
                head_r = _git(git_dir, "rev-parse", "HEAD", timeout=30)
                head = head_r.stdout.decode().strip() if head_r.returncode == 0 else None
                if head and head == cached.get("head"):
                    repos_out[name] = cached
                    truncated = truncated or bool(cached.get("truncated"))
                    continue
            try:
                res = scan_repo(git_dir)
            except Exception:
                continue    # one broken mirror must not kill the whole scan
            repos_out[name] = res
            truncated = truncated or res["truncated"]

        total = sum(len(e["findings"]) for e in repos_out.values())
        with_findings = sum(1 for e in repos_out.values() if e["findings"])
        data = {
            "summary": {
                "scanned_at": utcnow().isoformat(),
                "repos_scanned": len(repos_out),
                "repos_with_findings": with_findings,
                "total": total,
                "truncated": truncated,
            },
            "repos": repos_out,
        }
        path = _scan_path(username)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=1))
    return results_for(username)
