#!/bin/sh
# Drop from root to an unprivileged user before running the app, so an RCE in
# git/rclone/a dependency can't run as root. Started as root only long enough to
# make the data volume writable by the app user, then hands off via gosu.
set -e

APP_USER=app
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  want="$(id -u "$APP_USER")"
  have="$(stat -c '%u' "$DATA_DIR" 2>/dev/null || echo 0)"
  if [ "$have" != "$want" ]; then
    # First run after upgrading from a root-only image: existing backups are
    # root-owned. Chown once so the unprivileged app can read/write them. Later
    # starts skip this because the top-level dir is already ours.
    echo "[entrypoint] Making the data volume writable for the unprivileged app user."
    echo "[entrypoint] First run after this upgrade — on a large backup set this can take a few minutes. Please do not restart the container."
    chown -R "$APP_USER:$APP_USER" "$DATA_DIR" || echo "[entrypoint] warning: could not fully chown $DATA_DIR"
  fi
  # gosu keeps the current environment, so point HOME at the app user's home —
  # git/git-lfs/rclone write config/cache under ~ and must not target /root.
  export HOME=/home/"$APP_USER"
  exec gosu "$APP_USER" tini -- "$@"
fi

# Already unprivileged (e.g. the user set --user explicitly) — just run.
exec tini -- "$@"
