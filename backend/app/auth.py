"""Panel access protection: password hashing + signed session cookies.

The panel can be locked with a single password (stored only as a PBKDF2 hash,
never in plain text). A successful login sets a signed, time-limited session
cookie. The cookie is signed with the same Fernet key already used for token
encryption, so no extra secret is needed — and Fernet's built-in timestamp lets
us expire sessions.
"""
from __future__ import annotations

import hashlib
import hmac
import os

from . import crypto

SESSION_TTL = 60 * 60 * 24 * 30          # 30 days
COOKIE_NAME = "rk_session"
_ITERATIONS = 200_000
_SESSION_MARKER = b"repoark-panel-session"


def hash_password(password: str) -> str:
    """Return a self-describing PBKDF2 hash: algo$iters$salthex$hashhex."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    try:
        _algo, iters, salthex, hashhex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salthex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hashhex)
    except Exception:
        return False


def make_session() -> str:
    """Issue a signed session token (Fernet embeds the issue time for TTL)."""
    return crypto._get_fernet().encrypt(_SESSION_MARKER).decode()


def valid_session(token: str) -> bool:
    if not token:
        return False
    try:
        data = crypto._get_fernet().decrypt(token.encode(), ttl=SESSION_TTL)
        return data == _SESSION_MARKER
    except Exception:
        return False
