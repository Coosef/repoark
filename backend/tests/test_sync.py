"""Safe-sync guards: never wipe the remote from a local fault."""
from app import sync
from app.models import Destination


def test_sync_refuses_empty_local(monkeypatch, tmp_path):
    calls = {"n": 0}

    def _fake_run(*a, **k):
        calls["n"] += 1
        return 0, "x"

    monkeypatch.setattr(sync, "_run", _fake_run)
    d = Destination(name="d", type="s3", bucket="b", access_key="k")
    code, log = sync.sync(d, str(tmp_path), "user")   # tmp_path is empty
    assert code == 3
    assert calls["n"] == 0            # rclone was never invoked
    assert "boş" in log               # remote preserved


def test_sync_uses_backup_dir_for_a_populated_local(monkeypatch, tmp_path):
    (tmp_path / "file.txt").write_text("hi")
    seen = {}
    monkeypatch.setattr(sync, "_run",
                        lambda args, env, timeout: (seen.update(args=args), (0, "ok"))[1])
    d = Destination(name="d", type="s3", bucket="b", prefix="", access_key="k")
    code, _ = sync.sync(d, str(tmp_path), "user")
    assert code == 0
    assert "sync" in seen["args"]
    idx = seen["args"].index("--backup-dir")
    assert "__archive__" in seen["args"][idx + 1]   # deletions archived, not lost
