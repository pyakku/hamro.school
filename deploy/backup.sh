#!/bin/bash
# Nightly Postgres dump to S3, run by hamro-backup.timer.
#
# Dropping RDS means dropping its automated backups, so this is now the only
# thing between a dead instance and a school's records. It is deliberately
# boring: dump, compress, upload, verify the object is really there, and shout
# if anything failed.
set -euo pipefail

source /opt/hamro/env.sh
set -a
# shellcheck disable=SC1091
source /opt/hamro/.env
set +a

stamp=$(date -u +%Y%m%dT%H%M%SZ)
key="postgres/hamro_school-$${stamp}.sql.gz"
tmp="/tmp/hamro-backup-$${stamp}.sql.gz"

cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

# --clean --if-exists so the dump can be restored over an existing database.
docker compose -f /opt/hamro/docker-compose.yml exec -T postgres \
  pg_dump -U hamro -d hamro_school --clean --if-exists \
  | gzip -9 > "$tmp"

size=$(stat -c%s "$tmp")
if [ "$size" -lt 10000 ]; then
  echo "Backup is only $${size} bytes — that is not a school. Refusing to upload." >&2
  exit 1
fi

aws s3 cp "$tmp" "s3://$${BACKUP_BUCKET}/$${key}" \
  --region "$AWS_REGION" \
  --storage-class STANDARD_IA

# An upload that silently did nothing is worse than no backup, because you
# stop worrying about it.
aws s3api head-object \
  --bucket "$BACKUP_BUCKET" \
  --key "$key" \
  --region "$AWS_REGION" >/dev/null

echo "Backed up $${size} bytes to s3://$${BACKUP_BUCKET}/$${key}"
