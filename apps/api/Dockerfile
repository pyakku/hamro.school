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
#
# Debian, not Alpine, and the reason is build time. argon2 ships prebuilt
# bindings for glibc but not for musl, so on Alpine it compiles C++ from
# source — which, cross-building arm64 on an x86 runner under QEMU, took over
# thirty minutes. On glibc it just downloads the prebuilt binary.
FROM node:22-slim AS build

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

# prisma.config.ts resolves MIGRATION_DATABASE_URL strictly, and `prisma
# generate` loads the config even though it never opens a connection. A
# placeholder confined to this stage keeps the runtime check strict — the
# real URL is injected from SSM when `migrate deploy` actually runs, and this
# value cannot reach the final image because that is a separate stage.
ARG PRISMA_BUILD_URL=postgresql://build:build@localhost:5432/build

RUN MIGRATION_DATABASE_URL="$PRISMA_BUILD_URL" \
    DATABASE_URL="$PRISMA_BUILD_URL" \
    sh -c 'pnpm --filter @hamro/shared build && \
           pnpm --filter @hamro/api exec prisma generate && \
           pnpm --filter @hamro/api build'

# Drop the dev dependencies now that everything is compiled. The Prisma CLI is
# a runtime dependency on purpose — `migrate deploy` runs from this image.
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter @hamro/api... --filter @hamro/shared...

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# tini so signals reach node and the graceful shutdown in main.ts actually runs
# when the container is stopped.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000

# Never root. The API writes nothing to disk.
RUN groupadd --system hamro && useradd --system --gid hamro --no-create-home hamro
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

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
