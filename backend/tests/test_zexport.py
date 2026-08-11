"""Password-encrypted config export/import round-trip.

Named test_z* so it runs last — it sets a panel password on the shared test DB,
which would otherwise change auth state for other tests.
"""
import pytest
from fastapi.testclient import TestClient

from app import crypto
from app.main import app


def test_password_encrypt_roundtrip():
    enc = crypto.encrypt_with_password("hello secret", "pw123")
    assert crypto.decrypt_with_password(enc["salt"], enc["data"], "pw123") == "hello secret"
    with pytest.raises(Exception):
        crypto.decrypt_with_password(enc["salt"], enc["data"], "wrong-password")


def test_encrypted_export_then_import():
    with TestClient(app) as client:
        # Export is only allowed once a panel password is set (1.3.0 guard).
        client.post("/api/auth/set-password", json={"current": "", "new": "panelpass1"})

        r = client.post("/api/config/export", json={"passphrase": "filepw"})
        assert r.status_code == 200
        blob = r.json()
        assert blob.get("enc") == "repoark-encrypted-v1"
        assert "token" not in blob and "salt" in blob   # secrets are not in the clear

        blob["_passphrase"] = "filepw"
        assert client.post("/api/config/import", json=blob).status_code == 200

        blob["_passphrase"] = "wrong"
        assert client.post("/api/config/import", json=blob).status_code == 400
