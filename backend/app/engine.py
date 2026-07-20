"""Wrapper around the `github-backup` CLI (the download engine).

We translate a Job's checkboxes into github-backup flags and run it as a
subprocess, capturing its output. The token is passed via argv but always
redacted from any log we persist or show in the panel.

Flag names are verified against `github-backup --help` at container build time;
see build_args() for the mapping. Categories the user did not select are simply
omitted so nothing extra is downloaded.
"""
from __future__ import annotations

import os
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path


def build_args(username: str, token: str, output_dir: Path, *,
               repos: bool, private: bool, forks: bool, wikis: bool,
               issues: bool, starred: bool, gists: bool, releases: bool,
               starred_clone: bool = False, skip_archived: bool = False,
               exclude: str = "", organization: bool = False,
               incremental: bool = True) -> list[str]:
    args: list[str] = [
        "github-backup", username,
        "-t", token,
        "-o", str(output_dir),
        "--bare",            # store repos as space-efficient bare mirrors
    ]
    if organization:
        args.append("--organization")
    if incremental:
        args.append("--incremental")

    if repos:
        args.append("--repositories")
        if wikis:
            args.append("--wikis")
    if private:
        args.append("--private")
    if forks:
        args.append("--fork")
    if issues:
        args += ["--issues", "--issue-comments", "--pulls", "--pull-comments"]
    if starred:
        # --starred writes just the JSON list (cheap). --all-starred additionally
        # clones every starred repo's code, which can be many GB — opt-in only.
        args.append("--starred")
        if starred_clone:
            args.append("--all-starred")
    if gists:
        args += ["--gists", "--starred-gists"]
    if releases:
        args += ["--releases", "--assets"]
    if skip_archived:
        args.append("--skip-archived")
    names = [n for n in exclude.replace(",", " ").split() if n]
    if names:
        args += ["--exclude", *names]

    return args


def _redact(text: str, token: str) -> str:
    return text.replace(token, "***REDACTED***") if token else text


# --- Cancellation registry --------------------------------------------------
# Running github-backup subprocesses keyed by job_id, so a "stop" request on
# another request thread can terminate an in-flight backup. _CANCEL marks jobs
# the user asked to stop so run_backup can report a distinct "cancelled" result.
_reg_lock = threading.Lock()
_PROCS: dict[int, "subprocess.Popen"] = {}
_CANCEL: set[int] = set()


def request_cancel(job_id: int) -> bool:
    """Ask a running backup to stop. Returns True if a process was signalled."""
    with _reg_lock:
        _CANCEL.add(job_id)
        proc = _PROCS.get(job_id)
    if proc is None:
        return False
    try:
        proc.terminate()
    except Exception:
        pass
    return True


def is_cancelled(job_id: int) -> bool:
    with _reg_lock:
        return job_id in _CANCEL


def clear_cancel(job_id: int) -> None:
    with _reg_lock:
        _CANCEL.discard(job_id)


def run_backup(username: str, token: str, output_dir: Path, *, options: dict,
               timeout: int = 7200, job_id: int | None = None,
               on_line: Callable[[str], None] | None = None) -> tuple[int, str]:
    """Run github-backup, streaming output line by line.

    stderr is merged into stdout so we see git's own "Cloning into..." lines.
    Each redacted line is appended to the log and handed to on_line (used to
    publish live progress). A watchdog kills the process after `timeout`.
    Returns (exit_code, redacted_combined_output).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    args = build_args(username, token, output_dir, **options)
    # github-backup is itself a Python program; PYTHONUNBUFFERED makes its log
    # lines arrive in real time instead of being block-buffered on the pipe.
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    try:
        proc = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
    except FileNotFoundError:
        return 127, "github-backup executable not found in PATH"

    if job_id is not None:
        with _reg_lock:
            _PROCS[job_id] = proc

    timed_out = {"v": False}

    def _kill():
        timed_out["v"] = True
        proc.kill()

    watchdog = threading.Timer(timeout, _kill)
    watchdog.start()

    lines: list[str] = []
    try:
        for raw in proc.stdout:  # type: ignore[union-attr]
            line = _redact(raw, token)
            lines.append(line)
            if on_line:
                try:
                    on_line(line)
                except Exception:
                    pass  # progress reporting must never break the backup
        proc.wait()
    finally:
        watchdog.cancel()
        if job_id is not None:
            with _reg_lock:
                _PROCS.pop(job_id, None)

    log = "".join(lines)
    if job_id is not None and is_cancelled(job_id):
        return 130, log + "\n[durduruldu]"
    if timed_out["v"]:
        return 124, log + "\n[timed out]"
    return proc.returncode, log
