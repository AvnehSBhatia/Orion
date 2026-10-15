# syntax=docker/dockerfile:1.7
# Orion backend (server/). Build from the repo root:
#   docker build -f deploy/server.Dockerfile -t orion-server .
# Data lives on /data (SQLite per org + auth.db), models on /models (EmbeddingGemma ~520MB, tesseract).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# Toolchain only as a fallback for native modules without a prebuilt binary (better-sqlite3, sharp, onnxruntime).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
# Dev dependencies stay: scripts/account.ts and scripts/backup.ts run with tsx inside the container.
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY server/ ./
RUN rm -rf .env .env.* data .cache && node_modules/.bin/next build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    MODEL_CACHE_DIR=/models \
    PORT=3001
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates sqlite3 \
 && rm -rf /var/lib/apt/lists/*
# App files are root-owned and read-only for the app user; only the volumes and the Next cache are writable.
COPY --from=build /app ./
RUN mkdir -p /data /models /backups /app/.next/cache \
 && chown -R node:node /data /models /backups /app/.next/cache \
 && chmod 700 /data /backups
USER node
VOLUME ["/data", "/models"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3001"]
