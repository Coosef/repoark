"""Notifications: e-mail (SMTP) and Telegram, driven by Settings.

All sends are best-effort — a failing channel never breaks a backup. Secrets
(SMTP password, Telegram bot token) are stored encrypted and only decrypted
here at send time.
"""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

import httpx
from sqlmodel import Session, select

from . import crypto
from .models import Settings


def get_settings(session: Session) -> Settings:
    s = session.get(Settings, 1)
    if s is None:
        s = Settings(id=1)
        session.add(s)
        session.commit()
        session.refresh(s)
    return s


def _send_email(s: Settings, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.smtp_from or s.smtp_user
    msg["To"] = s.smtp_to
    msg.set_content(body)
    pw = crypto.decrypt(s.smtp_pass_enc) if s.smtp_pass_enc else ""
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as srv:
        if s.smtp_tls:
            srv.starttls(context=ssl.create_default_context())
        if s.smtp_user:
            srv.login(s.smtp_user, pw)
        srv.send_message(msg)


def _send_telegram(s: Settings, text: str) -> None:
    token = crypto.decrypt(s.telegram_token_enc) if s.telegram_token_enc else ""
    r = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": s.telegram_chat_id, "text": text},
        timeout=20,
    )
    r.raise_for_status()


def send(s: Settings, subject: str, body: str) -> list[str]:
    """Send to every enabled channel. Returns a list of error strings."""
    errors: list[str] = []
    if s.email_enabled:
        try:
            _send_email(s, subject, body)
        except Exception as e:
            errors.append(f"email: {e}")
    if s.telegram_enabled:
        try:
            _send_telegram(s, f"{subject}\n\n{body}")
        except Exception as e:
            errors.append(f"telegram: {e}")
    return errors


def _should_notify(s: Settings, status: str, changed: bool) -> bool:
    if status == "error":
        return s.notify_on_error
    if status == "success":
        return s.notify_on_success or (changed and s.notify_on_change)
    return False  # skipped -> quiet


def notify_run(s: Settings, account, job, run) -> None:
    if not (s.email_enabled or s.telegram_enabled):
        return
    if not _should_notify(s, run.status, run.changed):
        return
    emoji = {"success": "✅", "error": "❌", "skipped": "⏭️"}.get(run.status, "•")
    subject = f"{emoji} GitHub Yedek — {job.name}: {run.status}"
    lines = [
        f"Hesap: @{account.username}",
        f"İş: {job.name}",
        f"Durum: {run.status}",
        f"Değişiklik: {'evet' if run.changed else 'hayır'}",
    ]
    if run.status == "success":
        lines.append(f"Boyut: {run.size_bytes} bayt · {run.repo_count} repo · {run.star_count} yıldız")
    if run.status == "error" and run.log:
        lines.append("")
        lines.append("Son log:")
        lines.append(run.log[-500:])
    send(s, subject, "\n".join(lines))
