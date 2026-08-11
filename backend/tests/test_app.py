"""App-boot + security smoke tests.

Importing the app and hitting a couple of routes catches import errors and
regressions in the security middleware before the image is ever published.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    with TestClient(app) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


def test_security_headers_present():
    with TestClient(app) as client:
        r = client.get("/api/health")
        headers = {k.lower(): v for k, v in r.headers.items()}
        assert "content-security-policy" in headers
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert headers.get("x-frame-options") == "DENY"
        assert headers.get("x-content-type-options") == "nosniff"


def test_config_export_refused_without_password():
    # An open panel (no password) must never expose the secret-dumping export.
    with TestClient(app) as client:
        r = client.get("/api/config/export")
        assert r.status_code == 403


def test_test_config_never_pairs_stored_secret_with_new_endpoint(monkeypatch):
    """A saved destination's secret must only be tested against its own saved
    endpoint — never an attacker-supplied one (credential exfiltration)."""
    import app.sync as sync
    seen = {}
    monkeypatch.setattr(sync, "test",
                        lambda d: (seen.update(endpoint=d.endpoint, has_secret=bool(d.secret_key_enc)), (True, "ok"))[1])
    with TestClient(app) as client:
        created = client.post("/api/destinations", json={
            "name": "d", "type": "s3", "enabled": True, "endpoint": "https://real.example",
            "region": "", "bucket": "b", "prefix": "", "access_key": "k",
            "secret_key": "STORED-SECRET", "path": ""})
        assert created.status_code == 201
        dest_id = created.json()["id"]
        # Blank secret + id + a DIFFERENT (attacker) endpoint.
        r = client.post(f"/api/destinations/test-config?id={dest_id}", json={
            "name": "d", "type": "s3", "enabled": True, "endpoint": "https://attacker.example",
            "region": "", "bucket": "b", "prefix": "", "access_key": "k",
            "secret_key": "", "path": ""})
        assert r.status_code == 200
    # The stored secret was reused, but ONLY against the stored endpoint.
    assert seen["endpoint"] == "https://real.example"
    assert seen["has_secret"] is True
