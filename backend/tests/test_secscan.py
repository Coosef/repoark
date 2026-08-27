"""Secret scanning of backed-up mirrors: detection, masking, exclusions."""
import json
import subprocess
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app import config, db, secscan
from app.main import app
from app.models import Account

FAKE_AWS = "AKIAIOSFODNN7EXAMPLE"          # canonical AWS docs example key
FAKE_GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0" * 2   # 40-char body


def _run(*cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True)
    assert r.returncode == 0, r.stderr.decode()
    return r


def _make_mirror(work: Path, mirror: Path, files: dict[str, str]) -> None:
    """Commit `files` in a scratch repo and bare-clone it to `mirror`."""
    work.mkdir(parents=True, exist_ok=True)
    _run("git", "init", "-q", str(work))
    for name, content in files.items():
        p = work / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    _run("git", "-C", str(work), "add", "-A")
    _run("git", "-c", "user.email=t@t", "-c", "user.name=t",
         "-C", str(work), "commit", "-q", "-m", "x")
    mirror.parent.mkdir(parents=True, exist_ok=True)
    _run("git", "clone", "-q", "--bare", str(work), str(mirror))


def _setup_account(tmp_path: Path, username: str, repos: dict[str, dict[str, str]],
                   own_names=None) -> None:
    cur = config.BACKUPS_DIR / username / "current"
    for repo, files in repos.items():
        _make_mirror(tmp_path / f"work-{repo}",
                     cur / "repositories" / repo / "repository", files)
    if own_names is not None:
        (cur / "account").mkdir(parents=True, exist_ok=True)
        (cur / "account" / "repos.json").write_text(
            json.dumps([{"name": n} for n in own_names]))


def test_scan_finds_and_masks_secrets(tmp_path):
    _setup_account(tmp_path, "scanuser", {
        "leaky": {
            ".env": f"AWS_KEY={FAKE_AWS}\nDB_PASSWORD='supersecret42'\n",
            "config.json": '{"api_key": "changeme"}\n',        # placeholder
            "keys/id_rsa": "-----BEGIN OPENSSH PRIVATE KEY-----\nzzz\n",
            "src/app.py": f'gh = "{FAKE_GH}"\n',
            "README.md": "set PASSWORD in your env\n",          # no value: clean
        },
    })
    res = secscan.scan_account("scanuser")
    kinds = {f["kind"] for f in res["own"]["findings"]}
    assert {"aws_key", "github_token", "private_key",
            "credential_assign", "risky_file"} <= kinds
    blob = json.dumps(res)
    # The actual secrets must never appear in the results — masked previews only.
    assert FAKE_AWS not in blob and FAKE_GH not in blob and "supersecret42" not in blob
    assert "changeme" not in blob                       # placeholder not flagged
    # Persisted for the alerts endpoint.
    s = secscan.summary_for("scanuser")
    assert s["own_total"] == len(res["own"]["findings"]) and s["repos_with_findings"] == 1


def test_clean_repo_and_env_template_have_no_findings(tmp_path):
    _setup_account(tmp_path, "cleanuser", {
        "tidy": {
            ".env.example": "DB_PASSWORD='fill-me-in'\n",
            "main.py": "print('hello')\n",
            "docs/setup.md": "export TOKEN=... then run\n",
        },
    })
    res = secscan.scan_account("cleanuser")
    assert res["total"] == 0
    assert res["own"]["findings"] == [] and res["starred"]["findings"] == []


def test_starred_clones_scanned_separately(tmp_path):
    # 'mine' is the user's own repo; 'thirdparty' is a selected-starred clone
    # in the same repositories/ folder. Its leak must land in the STARRED
    # bucket (informational), never mixed into the user's own findings.
    _setup_account(tmp_path, "ownuser", {
        "mine": {"a.txt": "nothing here\n"},
        "thirdparty": {".env": f"KEY={FAKE_AWS}\n"},
    }, own_names=["mine"])
    cur = config.BACKUPS_DIR / "ownuser" / "current"
    (cur / "account" / "starred.json").write_text(
        json.dumps([{"full_name": "dev/thirdparty"}]))
    res = secscan.scan_account("ownuser")
    assert res["own"]["total"] == 0
    assert res["starred"]["total"] >= 1
    assert all(f["repo"] == "dev/thirdparty" for f in res["starred"]["findings"])
    # Routing metadata: GitHub link target + in-panel browse route.
    f = res["starred"]["findings"][0]
    assert f["full_name"] == "dev/thirdparty"
    assert f["browse"] == {"name": "thirdparty", "owner": "", "src": ""}


def test_all_starred_tree_is_scanned(tmp_path):
    # The engine's --all-starred layout: current/starred/<owner>/<repo>/repository
    _setup_account(tmp_path, "staruser", {"own1": {"a.txt": "clean\n"}},
                   own_names=["own1"])
    cur = config.BACKUPS_DIR / "staruser" / "current"
    _make_mirror(tmp_path / "work-star",
                 cur / "starred" / "acme" / "tool" / "repository",
                 {".env": f"KEY={FAKE_AWS}\n"})
    res = secscan.scan_account("staruser")
    assert res["own"]["total"] == 0
    assert res["starred"]["total"] >= 1
    assert any(f["repo"] == "acme/tool" and f["kind"] == "aws_key"
               for f in res["starred"]["findings"])
    f = res["starred"]["findings"][0]
    assert f["browse"] == {"name": "tool", "owner": "acme", "src": "starred"}


def test_cache_skips_unchanged_head(tmp_path, monkeypatch):
    _setup_account(tmp_path, "cacheuser", {"r1": {".env": "X_PASSWORD='topsecret99'\n"}})
    first = secscan.scan_account("cacheuser")
    assert first["total"] == 2      # risky .env file + the password inside it
    calls = []
    real = secscan.scan_repo
    monkeypatch.setattr(secscan, "scan_repo", lambda gd: calls.append(gd) or real(gd))
    second = secscan.scan_account("cacheuser")
    assert second["total"] == 2 and calls == []      # HEAD unchanged: no rescan
    forced = secscan.scan_account("cacheuser", force=True)
    assert forced["total"] == 2 and len(calls) == 1  # force rescans


def test_reveal_reads_the_flagged_line_on_demand(tmp_path):
    _setup_account(tmp_path, "revealuser",
                   {"r1": {".env": f"A=1\nAWS_KEY={FAKE_AWS}\n"}}, own_names=["r1"])
    res = secscan.scan_account("revealuser")
    f = next(x for x in res["own"]["findings"] if x["kind"] == "aws_key")
    out = secscan.reveal("revealuser", {"file": f["file"], "line": f["line"],
                                        "browse": f["browse"]})
    assert out["text"] == f"AWS_KEY={FAKE_AWS}"     # the real value, on demand only
    # Traversal / bogus input is rejected, never a filesystem walk.
    for bad in ({"file": "../x", "line": 1, "browse": f["browse"]},
                {"file": ".env", "line": 99, "browse": f["browse"]},
                {"file": ".env", "line": 1, "browse": {"name": "../../etc"}}):
        try:
            secscan.reveal("revealuser", bad)
            assert False, bad
        except ValueError:
            pass


def test_old_scan_data_gets_routing_fallbacks(tmp_path):
    # Results written by a pre-1.18 scan have no full_name/browse — the API
    # must still produce working jump targets without a rescan.
    path = secscan._scan_path("legacyuser")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "summary": {"total": 2, "repos_scanned": 2},
        "repos": {
            "myrepo": {"scope": "own", "head": "x",
                       "findings": [{"file": ".env", "line": 1, "kind": "aws_key",
                                     "label": "key", "preview": "AKIA…"}]},
            "dev/tool": {"scope": "starred", "head": "y",
                         "findings": [{"file": "a.yml", "line": 2, "kind": "github_token",
                                       "label": "key", "preview": "ghp_…"}]},
        }}))
    res = secscan.results_for("legacyuser")
    own = res["own"]["findings"][0]
    assert own["full_name"] == "legacyuser/myrepo"
    assert own["browse"] == {"name": "myrepo", "owner": "", "src": ""}
    starred = res["starred"]["findings"][0]
    assert starred["full_name"] == "dev/tool"
    assert starred["browse"] == {"name": "tool", "owner": "dev", "src": "starred"}


def test_progress_and_async_scan(tmp_path):
    _setup_account(tmp_path, "proguser", {"p1": {".env": "P_PASSWORD='longpassword12'\n"}})
    secscan.scan_account("proguser")
    p = secscan.progress_for("proguser")
    assert p["running"] is False and p["done"] == p["total"] >= 1
    assert secscan.results_for("proguser")["running"] is False
    # Background start returns immediately, then finishes on its own.
    assert secscan.start_scan_async("proguser") is True
    for _ in range(200):
        if not secscan.progress_for("proguser")["running"]:
            break
        time.sleep(0.05)
    assert secscan.progress_for("proguser")["running"] is False
    assert secscan.results_for("proguser")["total"] == 2


def test_endpoints_and_alert(tmp_path):
    db.init_db()
    with db.new_session() as s:
        acc = Account(username="apiuser", token_enc="x")
        s.add(acc)
        s.commit()
        s.refresh(acc)
        aid = acc.id
    _setup_account(tmp_path, "apiuser", {"web": {".env": f"K={FAKE_AWS}\n"}})
    with TestClient(app) as client:
        r = client.post(f"/api/accounts/{aid}/secret-scan", json={"wait": True})
        assert r.status_code == 200 and r.json()["total"] >= 1
        r = client.get(f"/api/accounts/{aid}/secret-scan")
        assert r.status_code == 200 and r.json()["total"] >= 1
        alerts = client.get("/api/alerts").json()
        assert any(a["username"] == "apiuser" and a["count"] >= 1
                   for a in alerts.get("secrets", []))
