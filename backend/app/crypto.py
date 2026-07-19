"""Token encryption at rest.

GitHub personal access tokens are secrets. We never store them in plain text:
each token is encrypted with Fernet (AES-128-CBC + HMAC) using a key that lives
in the data volume (or is injected via the SECRET_KEY env var).
"""
from __future__ import annotations

from cryptography.fernet import Fernet

from . import config

_fernet: Fernet | None = None


def _load_key() -> bytes:
    if config.SECRET_KEY_ENV:
        return config.SECRET_KEY_ENV.encode()
    # Generate once and persist to the data volume so restarts can still decrypt.
    if config.SECRET_KEY_FILE.exists():
        return config.SECRET_KEY_FILE.read_bytes()
    key = Fernet.generate_key()
    config.SECRET_KEY_FILE.write_bytes(key)
    config.SECRET_KEY_FILE.chmod(0o600)
    return key


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_key())
    return _fernet


def encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()
