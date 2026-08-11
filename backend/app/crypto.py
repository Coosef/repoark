"""Token encryption at rest.

GitHub personal access tokens are secrets. We never store them in plain text:
each token is encrypted with Fernet (AES-128-CBC + HMAC) using a key that lives
in the data volume (or is injected via the SECRET_KEY env var).
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet

from . import config

_KDF_ITERS = 200_000

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


# --- Password-based encryption (for the config export file) ---
# Independent of the panel's own key: derives a key from a user passphrase so an
# exported backup of the setup can be encrypted at rest and restored anywhere.

def _password_key(password: str, salt: bytes) -> bytes:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _KDF_ITERS)
    return base64.urlsafe_b64encode(dk)   # 32 bytes -> valid Fernet key


def encrypt_with_password(plaintext: str, password: str) -> dict:
    salt = os.urandom(16)
    token = Fernet(_password_key(password, salt)).encrypt(plaintext.encode())
    return {"salt": salt.hex(), "data": token.decode()}


def decrypt_with_password(salt_hex: str, data: str, password: str) -> str:
    salt = bytes.fromhex(salt_hex)
    return Fernet(_password_key(password, salt)).decrypt(data.encode()).decode()
