#!/usr/bin/env bash
# Deploy. Run from the repo root, from a laptop or from CI.
#
#   ./deploy/deploy.sh
#
# No SSH, no keys, no open port 22. Artifacts go to S3 and the instance is
# driven through SSM Run Command, which authenticates with the same IAM
# credentials as everything else.
#
# The API image is built for ARM (the box is Graviton) and pushed to GitHub
# Container Registry, which is free — ECR would be a few cents a month, but
# more importantly CI already has a GitHub token and would need an AWS one.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${GITHUB_REPOSITORY:=pyakku/hamro.school}"
OWNER="$(echo "$GITHUB_REPOSITORY" | cut -d/ -f1 | tr '[:upper:]' '[:lower:]')"
IMAGE="ghcr.io/${OWNER}/hamro-api"
SHA="$(git rev-parse --short HEAD)"

# Everything else comes from the Terraform state, so there is one source of
# truth for what is deployed where.
pushd infra >/dev/null
REGION="$(tofu output -raw region 2>/dev/null || echo "${AWS_REGION:-ap-south-1}")"
INSTANCE_ID="$(tofu output -raw instance_id)"
BUCKET="$(tofu output -raw backup_bucket)"
HOSTNAME="$(tofu output -raw url | sed 's|https://||')"
popd >/dev/null

echo "→ Deploying ${SHA} to ${HOSTNAME} (${INSTANCE_ID}, ${REGION})"

# ── 1. Build and push the API image ─────────────────────────────────────────
# The box is arm64; building for the wrong architecture is the classic way to
# get an "exec format error" in a container that pulled perfectly.
echo "→ Building API image for linux/arm64"
docker buildx build \
  --platform linux/arm64 \
  -f apps/api/Dockerfile \
  -t "${IMAGE}:${SHA}" \
  -t "${IMAGE}:latest" \
  --push \
  .

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

docker compose -f /opt/hamro/docker-compose.yml pull
docker compose -f /opt/hamro/docker-compose.yml up -d postgres
docker compose -f /opt/hamro/docker-compose.yml up -d --wait postgres

# Migrations run as the owner role, which is exempt from RLS, and from the
# same image that is about to serve traffic.
docker compose -f /opt/hamro/docker-compose.yml run --rm \\
  -e MIGRATION_DATABASE_URL \\
  --entrypoint /sbin/tini \\
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
