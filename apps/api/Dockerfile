# syntax=docker/dockerfile:1.7
#
# The API image.
#
# One image does two jobs: it serves requests, and — run with a different
# command — it applies migrations. Keeping them in the same artifact means the
# migration that runs against production is the one built from the commit being
# deployed, not whatever the deployer happened to have checked out.
#
# Built from the repo root, because pnpm needs the workspace:
#   docker build -f apps/api/Dockerfile -t hamro-api .

# ── Build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

# argon2 compiles a native binding; alpine needs a toolchain for it.
RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable
WORKDIR /repo

# Manifests first, so a change to source code does not invalidate the
# dependency layer. This is most of the build time.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --filter @hamro/api... --filter @hamro/shared...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @hamro/shared build && \
    pnpm --filter @hamro/api exec prisma generate && \
    pnpm --filter @hamro/api build

# Drop the dev dependencies now that everything is compiled. The Prisma CLI is
# a runtime dependency on purpose — `migrate deploy` runs from this image.
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter @hamro/api... --filter @hamro/shared...

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# libc6-compat for the prebuilt argon2 binding; tini so signals reach node and
# the graceful shutdown in main.ts actually runs on an ECS task stop.
RUN apk add --no-cache libc6-compat tini

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000

# Never root. The API writes nothing to disk.
RUN addgroup -S hamro && adduser -S hamro -G hamro
WORKDIR /repo

# pnpm's node_modules are a tree of relative symlinks, so the workspace has to
# be copied whole rather than cherry-picked.
COPY --from=build --chown=hamro:hamro /repo /repo

USER hamro
EXPOSE 4000

# ECS and the ALB both health check /health, which touches the database — a
# process that is up but cannot reach Postgres is not healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
