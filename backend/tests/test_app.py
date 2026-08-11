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
