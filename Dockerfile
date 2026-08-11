# syntax=docker/dockerfile:1

# ---- Stage 1: build the React panel ----
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime that serves API + built panel ----
FROM python:3.12-slim AS runtime
# Version is passed in at build time (see the CI workflow / VERSION file) and
# surfaced in the panel so users can confirm which version is running.
ARG APP_VERSION=dev
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/data \
    APP_VERSION=$APP_VERSION

# git + git-lfs: required by the github-backup engine to clone repos.
# rclone: used to sync backups to S3-compatible remote destinations.
# tini: a real init as PID 1 so SIGTERM on stop/update is forwarded and the
#       git children spawned by a backup are reaped instead of orphaned.
# gosu: drop from root to the unprivileged app user at startup (see entrypoint).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates rclone tini gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /fe/dist ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000
VOLUME ["/data"]

# Fail the container health when the API stops answering, so CasaOS/Docker can
# restart a wedged process (restart: unless-stopped only catches a full exit).
# Generous start-period: a first run after upgrading may spend a while chowning
# the data volume to the app user before the API comes up (see entrypoint).
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status==200 else 1)"

# The entrypoint drops root -> app (via gosu) and runs tini as PID 1.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
