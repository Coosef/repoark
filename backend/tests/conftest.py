"""Pytest bootstrap.

Point DATA_DIR at a throwaway temp dir BEFORE any app module is imported, so
the test run never touches a real data volume (config.DATA_DIR and the SQLite
engine are resolved at import time).
"""
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="repoark-test-")
os.environ.setdefault("APP_VERSION", "test")
os.environ.setdefault("REPOARK_MIN_FREE_MB", "500")
