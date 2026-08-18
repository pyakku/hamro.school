#!/usr/bin/env bash
# Rebuild the demo school on production. Deliberate, and destructive: it deletes
# one tenant and seeds it again. Every other school is untouched.
#
#   ./deploy/reseed-demo.sh
#
# Demo data ages. The seed anchors on the day it runs, so a fortnight later the
# registers stop before today and the homework is all overdue. Run this before a
# demo.
#
# Why it is not simply "run the seed against the database": production Postgres
# publishes no ports, so it is reachable only from the compose network on the
# instance — not from here, with or without a tunnel. And the runtime image
# cannot seed, because it is pruned of dev dependencies and the seed is
# TypeScript run through tsx. So the seed runs from the Dockerfile's `build`
# stage, in a one-off container, on that network.
set -euo pipefail

cd "$(dirname "$0")/.."

SHA="$(git rev-parse --short HEAD)"

if [ -z "${INSTANCE_ID:-}" ]; then
  pushd infra >/dev/null
  REGION="$(tofu output -raw region)"
  INSTANCE_ID="$(tofu output -raw instance_id)"
  REGISTRY="$(tofu output -raw ecr_repository_url)"
  popd >/dev/null
fi

: "${REGION:?set REGION or run from a directory with Terraform state}"
: "${REGISTRY:?set REGISTRY (the ECR repository URL)}"

TAG="seed-${SHA}"
IMAGE="${REGISTRY}:${TAG}"

echo "→ This DELETES the demo school on production and rebuilds it."
printf '  Type "reseed" to continue: '
read -r confirm
[ "$confirm" = "reseed" ] || { echo "Nothing done."; exit 1; }

# ── 1. The seed image ───────────────────────────────────────────────────────
# The `build` stage, which still has tsx and prisma/*.ts. Tagged `seed-` so
# nothing in the deploy path can pick it up by accident: deploy.sh only ever
# looks for the plain SHA.
echo "→ Building the seed image (${TAG})"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${REGISTRY%%/*}"

docker buildx build \
  --platform linux/arm64 \
  -f apps/api/Dockerfile \
  --target build \
  -t "$IMAGE" \
  --push \
  .

# ── 2. Run it on the instance ───────────────────────────────────────────────
echo "→ Rebuilding the demo school on ${INSTANCE_ID}"
COMMAND=$(cat <<SCRIPT
set -euo pipefail
cd /opt/hamro

# The seed image carries dev dependencies and is far larger than the runtime
# one. This box is a t4g.micro; filling its disk would take the site down,
# which is a poor trade for refreshing demo data.
docker image prune -f >/dev/null 2>&1 || true
avail=\$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
echo "Free disk: \${avail}G"
if [ "\${avail}" -lt 6 ]; then
  echo "Not enough free disk for the seed image." >&2
  exit 1
fi

aws ecr get-login-password --region ${REGION} \\
  | docker login --username AWS --password-stdin ${REGISTRY%%/*}
docker pull --quiet ${IMAGE}

# xtrace stays off from here: the command line carries the database URL, and
# SSM output goes to CloudWatch.
set +x
echo "SEED_IMAGE=${IMAGE}" > /opt/hamro/.env.seed
set -a
. /opt/hamro/.env
. /opt/hamro/.env.seed
set +a

docker compose -f /opt/hamro/docker-compose.yml --profile seed run --rm seed \\
  'node_modules/.bin/tsx prisma/reset-demo.ts modelschool && node_modules/.bin/tsx prisma/seed.ts'

rm -f /opt/hamro/.env.seed
docker image rm ${IMAGE} || true
docker image prune -f >/dev/null 2>&1 || true
SCRIPT
)

# Via a JSON file rather than the CLI's `commands=` shorthand, whose parser
# mangles anything containing a comma or a quote.
jq -n --arg s "$COMMAND" '{commands: [$s]}' > /tmp/hamro-reseed.json

command_id=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "Reseed modelschool" \
  --parameters file:///tmp/hamro-reseed.json \
  --region "$REGION" \
  --query 'Command.CommandId' --output text)

echo "  SSM command ${command_id}"
aws ssm wait command-executed \
  --command-id "$command_id" --instance-id "$INSTANCE_ID" --region "$REGION" 2>/dev/null || true

aws ssm get-command-invocation \
  --command-id "$command_id" --instance-id "$INSTANCE_ID" --region "$REGION" \
  --query 'StandardOutputContent' --output text

status=$(aws ssm get-command-invocation \
  --command-id "$command_id" --instance-id "$INSTANCE_ID" --region "$REGION" \
  --query 'Status' --output text)

if [ "$status" != "Success" ]; then
  aws ssm get-command-invocation \
    --command-id "$command_id" --instance-id "$INSTANCE_ID" --region "$REGION" \
    --query 'StandardErrorContent' --output text >&2
  echo "→ Reseed failed (${status})" >&2
  exit 1
fi

echo "→ Demo school rebuilt, anchored on today."
