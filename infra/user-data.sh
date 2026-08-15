#!/bin/bash
# Runs once, on first boot. Prepares the box; it does not deploy the app —
# that is `deploy/deploy.sh`, driven from CI or your laptop over SSM.
set -euxo pipefail

dnf update -y
dnf install -y docker git postgresql16

# ── Swap ────────────────────────────────────────────────────────────────────
# 1 GB of RAM has to hold Postgres, Node and Caddy. Swap is what turns a
# momentary spike from an OOM kill into a slow second. It is not a substitute
# for memory, and if the box is swapping constantly that is the signal to move
# to t4g.small.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Prefer reclaiming cache over swapping; only swap under real pressure.
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-hamro.conf

# ── Docker ──────────────────────────────────────────────────────────────────
systemctl enable --now docker
usermod -aG docker ec2-user

# Compose v2 as a CLI plugin.
COMPOSE_VERSION=v2.32.4
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL \
  "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Container logs are the fastest way to fill a 30 GB disk.
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
systemctl restart docker

# ── Application directory ───────────────────────────────────────────────────
install -d -o ec2-user -g ec2-user /opt/hamro
install -d -o ec2-user -g ec2-user /opt/hamro/web

cat > /opt/hamro/env.sh <<EOF
export AWS_REGION=${region}
export HAMRO_ENVIRONMENT=${environment}
export HAMRO_HOSTNAME=${hostname}
export ACME_EMAIL=${acme_email}
export BACKUP_BUCKET=${backup_bucket}
export PARAMETER_PREFIX=${parameter_prefix}
EOF
chown ec2-user:ec2-user /opt/hamro/env.sh

# ── Secrets ─────────────────────────────────────────────────────────────────
# Pulled from SSM into an env file Docker Compose reads. Root-only: anyone who
# can read this file can read every school's data.
cat > /usr/local/bin/hamro-fetch-secrets <<'SCRIPT'
#!/bin/bash
set -euo pipefail
source /opt/hamro/env.sh

umask 077
tmp=$(mktemp)
aws ssm get-parameters-by-path \
  --path "$PARAMETER_PREFIX" \
  --with-decryption \
  --region "$AWS_REGION" \
  --query 'Parameters[].[Name,Value]' \
  --output text \
| while IFS=$'\t' read -r name value; do
    echo "$(basename "$name")=$value"
  done > "$tmp"

{
  echo "HAMRO_HOSTNAME=$HAMRO_HOSTNAME"
  echo "ACME_EMAIL=$ACME_EMAIL"
  echo "NODE_ENV=production"
} >> "$tmp"

mv "$tmp" /opt/hamro/.env
chmod 600 /opt/hamro/.env
SCRIPT
chmod +x /usr/local/bin/hamro-fetch-secrets
/usr/local/bin/hamro-fetch-secrets

# ── Nightly backup ──────────────────────────────────────────────────────────
# Self-hosted Postgres has no automated backups. This is the whole safety net,
# so it is set up before the application is, not after.
cat > /etc/systemd/system/hamro-backup.service <<'UNIT'
[Unit]
Description=Nightly Postgres dump to S3
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/hamro/backup.sh
UNIT

cat > /etc/systemd/system/hamro-backup.timer <<'UNIT'
[Unit]
Description=Nightly Postgres dump to S3

[Timer]
# 18:30 UTC is just past midnight in Kathmandu, when nobody is taking a
# register.
OnCalendar=*-*-* 18:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
# enable --now: `enable` alone only arms it for the next boot, which on a box
# that is never rebooted means the first backup never runs.
systemctl enable --now hamro-backup.timer

echo "Instance ready. Deploy with deploy/deploy.sh."
