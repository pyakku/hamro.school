#!/usr/bin/env bash
# Deploy. Run from the repo root, on your own machine.
#
#   ./deploy/deploy.sh
#
# **Not on the instance.** That box is a t4g.micro sharing 1 GB between
# Postgres, the API and Caddy; building a Node image on it would thrash swap or
# get OOM-killed, and take the live site down with it. It has no repo and no
# build toolchain, deliberately. The only things that ever run there are what
# this script tells it over SSM: pull, migrate, restart.
#
# No SSH, no keys, no open port 22. Artifacts go to S3 and the instance is
# driven through SSM Run Command, which authenticates with the same IAM
# credentials as everything else.
#
# The API image is built for ARM (the box is Graviton) and pushed to ECR. Not
# ghcr.io: a private ghcr package needs a GitHub token stored on the instance
# to pull from, and a public one would put our source in a public image. ECR
# authenticates with the instance's own IAM role and costs a few cents.
set -euo pipefail

cd "$(dirname "$0")/.."

SHA="$(git rev-parse --short HEAD)"

# From the environment when CI sets it, from Terraform state when a human runs
# this on a laptop. CI has no state file, and a human should not have to know
# four ids by heart.
if [ -z "${INSTANCE_ID:-}" ]; then
  pushd infra >/dev/null
  REGION="$(tofu output -raw region)"
  INSTANCE_ID="$(tofu output -raw instance_id)"
  BUCKET="$(tofu output -raw backup_bucket)"
  HOSTNAME="$(tofu output -raw url | sed 's|https://||')"
  REGISTRY="$(tofu output -raw ecr_repository_url)"
  popd >/dev/null
fi

: "${REGION:?set REGION or run from a directory with Terraform state}"
: "${BUCKET:?set BUCKET}"
: "${HOSTNAME:?set HOSTNAME}"
: "${REGISTRY:?set REGISTRY (the ECR repository URL)}"
IMAGE="$REGISTRY"

echo "→ Deploying ${SHA} to ${HOSTNAME} (${INSTANCE_ID}, ${REGION})"

# ── 1. Build and push the API image ─────────────────────────────────────────
# The box is arm64; building for the wrong architecture is the classic way to
# get an "exec format error" in a container that pulled perfectly.
#
# CI builds the image in its own step (with a layer cache and a registry token
# it already has), so it sets SKIP_IMAGE_BUILD and this is a no-op there.
if [ "${SKIP_IMAGE_BUILD:-0}" != "1" ]; then
  echo "→ Building API image for linux/arm64"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "${REGISTRY%%/*}"
  docker buildx build \
    --platform linux/arm64 \
    -f apps/api/Dockerfile \
    -t "${IMAGE}:${SHA}" \
    -t "${IMAGE}:latest" \
    --push \
    .
else
  echo "→ Skipping image build; using ${IMAGE}:${SHA}"
fi

# ── 2. Build the web app ────────────────────────────────────────────────────
# Same origin as the API, so the browser calls /api/... and there is no CORS
# and no absolute URL baked into the bundle.
# shared has to be compiled first: the web app imports @hamro/shared, which
# resolves to its dist, and tsc will not find types that do not exist yet.
echo "→ Building web app"
pnpm --filter @hamro/shared build
VITE_API_URL=/api VITE_BASE_DOMAIN="${BASE_DOMAIN:-hamro.school}" pnpm --filter @hamro/web build

# ── 3. Ship artifacts ───────────────────────────────────────────────────────
echo "→ Uploading artifacts"
tar -czf /tmp/hamro-web.tgz -C apps/web/dist .

# The compose bundle, with the Postgres init script copied in from its single
# source of truth rather than duplicated in this directory.
rm -rf /tmp/hamro-deploy && mkdir -p /tmp/hamro-deploy/postgres-init
cp deploy/docker-compose.yml deploy/Caddyfile deploy/backup.sh /tmp/hamro-deploy/
cp docker/postgres/init/*.sql /tmp/hamro-deploy/postgres-init/
tar -czf /tmp/hamro-deploy.tgz -C /tmp/hamro-deploy .

aws s3 cp /tmp/hamro-web.tgz "s3://${BUCKET}/artifacts/web-${SHA}.tgz" --region "$REGION"
aws s3 cp /tmp/hamro-deploy.tgz "s3://${BUCKET}/artifacts/deploy-${SHA}.tgz" --region "$REGION"

# ── 4. Roll it out ──────────────────────────────────────────────────────────
echo "→ Rolling out on the instance"
COMMAND=$(cat <<SCRIPT
set -euo pipefail
set -x
cd /opt/hamro

aws s3 cp s3://${BUCKET}/artifacts/deploy-${SHA}.tgz /tmp/deploy.tgz --region ${REGION}
tar -xzf /tmp/deploy.tgz -C /opt/hamro
chmod +x /opt/hamro/backup.sh

# Unpack the web app into a fresh directory and swap it in, so a half-extracted
# tarball is never being served.
aws s3 cp s3://${BUCKET}/artifacts/web-${SHA}.tgz /tmp/web.tgz --region ${REGION}
rm -rf /opt/hamro/web.new && mkdir -p /opt/hamro/web.new
tar -xzf /tmp/web.tgz -C /opt/hamro/web.new
rm -rf /opt/hamro/web.old
[ -d /opt/hamro/web ] && mv /opt/hamro/web /opt/hamro/web.old
mv /opt/hamro/web.new /opt/hamro/web

/usr/local/bin/hamro-fetch-secrets
echo "API_IMAGE=${IMAGE}:${SHA}" >> /opt/hamro/.env

# The instance authenticates to ECR with its own IAM role. No registry
# credential is stored on the box.
aws ecr get-login-password --region ${REGION} \\
  | docker login --username AWS --password-stdin ${REGISTRY%%/*}

# --quiet, or layer-by-layer progress fills the 24KB SSM output buffer and
# truncates away whatever actually went wrong.
docker compose -f /opt/hamro/docker-compose.yml pull --quiet
docker compose -f /opt/hamro/docker-compose.yml up -d --wait postgres

# xtrace stays OFF for the rest of this script. It is not enough to disable it
# while sourcing the env file: the migration command below interpolates the
# database URL, and with tracing on the expanded command line — password and
# all — is echoed into the SSM output and from there into CloudWatch.
set +x
set -a
. /opt/hamro/.env
set +a

# Migrations run as the owner role, which is exempt from RLS, and from the
# same image that is about to serve traffic.
#
# --workdir, because Prisma looks for prisma.config.ts relative to the working
# directory and the image's default is the workspace root. The CLI itself lives
# in the package's own node_modules; that is how pnpm links binaries.
echo "Running migrations"
docker compose -f /opt/hamro/docker-compose.yml run --rm \\
  --workdir /repo/apps/api \\
  -e MIGRATION_DATABASE_URL \\
  --entrypoint /usr/bin/tini \\
  api -- node_modules/.bin/prisma migrate deploy

docker compose -f /opt/hamro/docker-compose.yml up -d --wait
docker image prune -f
SCRIPT
)

# Via a JSON file, not the CLI's `commands=` shorthand: the shorthand parser
# mangles the \n escapes in a multi-line script, and the instance receives one
# run-on line ("set: pipefailncd: invalid option name").
jq -n --arg script "$COMMAND" '{commands: [$script]}' > /tmp/hamro-ssm-params.json

COMMAND_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "hamro deploy ${SHA}" \
  --timeout-seconds 900 \
  --parameters file:///tmp/hamro-ssm-params.json \
  --query 'Command.CommandId' --output text)

echo "→ SSM command ${COMMAND_ID}; waiting"
aws ssm wait command-executed \
  --region "$REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" || true

aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,Out:StandardOutputContent,Err:StandardErrorContent}' \
  --output text

# The status was previously printed and then ignored, so a rollout that failed
# on the instance carried on to the health check below and passed it.
SSM_STATUS=$(aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query 'Status' --output text)

if [ "$SSM_STATUS" != "Success" ]; then
  echo "✗ The rollout failed on the instance (${SSM_STATUS})." >&2
  exit 1
fi

# ── 5. Prove it ─────────────────────────────────────────────────────────────
#
# Health alone is not proof of a deploy. The *previous* container answers
# /health perfectly well, so a rollout that never happened used to print
# "✓ <sha> is live" and exit 0 — which is the worst possible outcome, because
# it is indistinguishable from success. Ask the instance what it is actually
# running and compare.
echo "→ Checking what is running on the instance"
RUNNING=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["docker ps --format {{.Image}} | grep hamro-api | head -1"]' \
  --query 'Command.CommandId' --output text)

aws ssm wait command-executed \
  --region "$REGION" --command-id "$RUNNING" --instance-id "$INSTANCE_ID" 2>/dev/null || true

RUNNING_IMAGE=$(aws ssm get-command-invocation \
  --region "$REGION" --command-id "$RUNNING" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text | tr -d '[:space:]')

case "$RUNNING_IMAGE" in
  *":${SHA}") echo "  running ${RUNNING_IMAGE}" ;;
  *)
    echo "✗ The instance is running ${RUNNING_IMAGE:-nothing}, not ${SHA}." >&2
    echo "  The rollout did not take. Nothing was deployed." >&2
    exit 1
    ;;
esac

echo "→ Checking https://${HOSTNAME}/health"
for attempt in $(seq 1 20); do
  if curl -fsS "https://${HOSTNAME}/health" >/dev/null 2>&1; then
    curl -fsS "https://${HOSTNAME}/health"
    echo
    echo "✓ ${SHA} is live at https://${HOSTNAME}"
    exit 0
  fi
  sleep 5
done

echo "✗ Health check never passed. Logs:" >&2
echo "  aws ssm start-session --target ${INSTANCE_ID} --region ${REGION}" >&2
echo "  docker compose -f /opt/hamro/docker-compose.yml logs --tail 100" >&2
exit 1
