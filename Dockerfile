# syntax=docker/dockerfile:1

# ---- Stage 1: build the React panel ----
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json ./
RUN npm install
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
RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates rclone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /fe/dist ./static

EXPOSE 8000
VOLUME ["/data"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
