"""Auto-prune of 'download all starred' clones that are no longer starred."""
import json

from app import config
from app.routers.content import prune_unstarred


def _mk_clone(username, owner, repo):
    d = config.BACKUPS_DIR / username / "current" / "starred" / owner / repo / "repository"
    d.mkdir(parents=True, exist_ok=True)
    (d / "HEAD").write_text("ref: refs/heads/main\n")


def _write_starred(username, full_names):
    p = config.BACKUPS_DIR / username / "current" / "account"
    p.mkdir(parents=True, exist_ok=True)
    (p / "starred.json").write_text(json.dumps([{"full_name": fn} for fn in full_names]))


def test_prune_removes_unstarred_keeps_starred():
    u = "pruneuser"
    _mk_clone(u, "alice", "keep")
    _mk_clone(u, "bob", "gone")
    _write_starred(u, ["alice/keep"])          # bob/gone no longer starred
    r = prune_unstarred(u)
    assert r["removed"] == 1
    assert (config.BACKUPS_DIR / u / "current" / "starred" / "alice" / "keep").is_dir()
    assert not (config.BACKUPS_DIR / u / "current" / "starred" / "bob").exists()


def test_prune_does_nothing_when_list_unavailable():
    u = "pruneuser2"
    _mk_clone(u, "alice", "keep")
    _write_starred(u, [])                       # empty list -> guard, don't wipe
    r = prune_unstarred(u)
    assert r["removed"] == 0
    assert (config.BACKUPS_DIR / u / "current" / "starred" / "alice" / "keep").is_dir()
