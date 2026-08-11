"""Restore-drill test: a real bare mirror must verify as restorable."""
import subprocess

from app import config, health


def _run(*args, cwd=None):
    subprocess.run(list(args), cwd=cwd, check=True, capture_output=True)


def _make_mirror(username: str, repo: str):
    base = config.BACKUPS_DIR / username / "current" / "repositories"
    src = base / (repo + "-src")
    src.mkdir(parents=True, exist_ok=True)
    _run("git", "init", "-q", str(src))
    _run("git", "-C", str(src), "config", "user.email", "t@example.com")
    _run("git", "-C", str(src), "config", "user.name", "t")
    (src / "README.md").write_text("hello")
    _run("git", "-C", str(src), "add", "-A")
    _run("git", "-C", str(src), "commit", "-qm", "init")
    dest = base / repo / "repository"
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run("git", "clone", "--mirror", "-q", str(src), str(dest))


def test_restore_drill_verifies_a_real_mirror():
    _make_mirror("driller", "demo")
    r = health.restore_drill("driller", sample=3)
    assert r["total"] >= 1
    assert r["ok"] is True
    assert r["ok_count"] == r["sampled"] >= 1
    assert any(e["repo"] == "demo" and e["ok"] for e in r["tested"])


def test_restore_drill_no_repos_is_ok():
    r = health.restore_drill("nobody-here", sample=3)
    assert r["total"] == 0 and r["ok"] is True
