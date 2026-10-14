# syntax=docker/dockerfile:1.7
# Orion web dashboard (web/). Build from the repo root:
#   docker build -f deploy/web.Dockerfile --build-arg NEXT_PUBLIC_ORION_API=https://api.example.com -t orion-web .
# NEXT_PUBLIC_ORION_API is baked into the browser bundle at build time; changing it means rebuilding.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_ORION_API
RUN test -n "$NEXT_PUBLIC_ORION_API" || (echo "Set --build-arg NEXT_PUBLIC_ORION_API=https://api.<domain>" >&2; exit 1)
ENV NEXT_PUBLIC_ORION_API=${NEXT_PUBLIC_ORION_API} \
    NEXT_TELEMETRY_DISABLED=1
COPY web/ ./
RUN rm -rf .env .env.* && node_modules/.bin/next build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app
COPY --from=build /app ./
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
