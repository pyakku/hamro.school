#!/usr/bin/env bash
# Deploy. Run from the repo root, from a laptop or from CI.
#
#   ./deploy/deploy.sh
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
echo "→ Building web app"
VITE_API_URL=/api pnpm --filter @hamro/web build

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
set -euxo pipefail
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

docker compose -f /opt/hamro/docker-compose.yml pull
docker compose -f /opt/hamro/docker-compose.yml up -d postgres
docker compose -f /opt/hamro/docker-compose.yml up -d --wait postgres

# Migrations run as the owner role, which is exempt from RLS, and from the
# same image that is about to serve traffic.
docker compose -f /opt/hamro/docker-compose.yml run --rm \\
  -e MIGRATION_DATABASE_URL \\
  --entrypoint /usr/bin/tini \\
  api -- node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

docker compose -f /opt/hamro/docker-compose.yml up -d --wait
docker image prune -f
SCRIPT
)

COMMAND_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "hamro deploy ${SHA}" \
  --parameters "commands=$(printf '%s' "$COMMAND" | jq -Rs .)" \
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

# ── 5. Prove it ─────────────────────────────────────────────────────────────
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
