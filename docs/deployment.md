# Deployment

One `t4g.micro` runs everything: Caddy, the API and Postgres. **~$12/month.**

```
                    app.hamro.school
                           │  443
                    ┌──────▼──────┐
                    │    Caddy    │  TLS from Let's Encrypt
                    │             │  /api/* → api:4000
                    │             │  /*     → the built SPA
                    └──────┬──────┘
                    ┌──────▼──────┐     ┌──────────────┐
                    │     api     │────▶│   postgres   │
                    └─────────────┘     └──────┬───────┘
                                               │ nightly pg_dump
                                        ┌──────▼───────┐
                                        │  S3 backups  │
                                        └──────────────┘
```

## Why this shape

**One origin.** Caddy serves the web app and proxies `/api` on the same
hostname, so the browser never makes a cross-origin request. That removes CORS,
removes cross-site cookie rules, and removes the whole class of "works locally,
session dies in production" bugs. The Flutter apps use the same URLs.

**No load balancer, no RDS, no NAT.** Together those are roughly $60/month of
AWS for availability this product does not need yet.

**What that costs you, honestly:**

| | Now | When it matters |
|---|---|---|
| Deploy | A few seconds of downtime | Add a second instance and an ALB |
| Instance dies | Restore from last night's dump | Move Postgres to RDS |
| Memory | 1 GB shared between Postgres and Node | `t4g.small` — stop, change, start |
| Data loss window | Up to 24 hours | Continuous archiving, or RDS |

The 24-hour window is the one to watch. A school that loses a day of attendance
and fee receipts will notice, and moving to more frequent dumps is a one-line
change to the systemd timer.

## Cost

| | |
|---|---|
| t4g.micro | ~$6.10 |
| 30 GB gp3 | ~$2.40 |
| Public IPv4 | ~$3.60 |
| S3 backups | ~$0.10 |
| **Total** | **~$12.20/month** |

Estimates, on-demand, `ap-south-1`. `us-east-1` saves about $0.30/month and
adds ~250ms round-trip for users in Nepal and India — not worth it.

Plus ~$0.03 for the container image in ECR. Not on the bill: SSM, Let's
Encrypt, and GitHub Actions on a public runner.

## First deploy

**1. Log in.**

```bash
aws login          # or aws sso login
aws sts get-caller-identity
```

**2. Create the stack.**

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit if needed
tofu init
tofu apply
```

Takes about three minutes. It creates a VPC, the instance, an Elastic IP, the
backups bucket and the secrets in SSM. Passwords and JWT secrets are generated
here and never printed.

**3. Point DNS at it.** `tofu output dns_record_to_create` gives you an A
record. Add it at Hostinger:

| Type | Name | Value |
|---|---|---|
| A | `app` | the Elastic IP |

Caddy gets a certificate on its own within a minute of that resolving. Nothing
to configure and nothing to renew.

**4. Tell GitHub where to deploy.** Four repository variables, from the
Terraform outputs:

```bash
gh variable set AWS_REGION      --body "$(cd infra && tofu output -raw region)"
gh variable set AWS_DEPLOY_ROLE --body "$(cd infra && tofu output -raw github_actions_role_arn)"
gh variable set ARTIFACT_BUCKET --body "$(cd infra && tofu output -raw backup_bucket)"
gh variable set ECR_REPOSITORY  --body "$(cd infra && tofu output -raw ecr_repository_url)"
gh variable set APP_HOSTNAME    --body "$(cd infra && tofu output -raw url | sed 's|https://||')"
```

**5. Deploy.**

```bash
gh workflow run deploy.yml -f confirm=deploy      # or the Actions tab
```

Builds the ARM image and pushes it to ECR, builds the web app, uploads both to
S3, then drives the instance over SSM: pull, migrate, restart, verify
`/health`. It fails the job if the health check never passes.

From a laptop instead, with Docker installed:

```bash
./deploy/deploy.sh
```

## How the pipeline authenticates

Nothing long-lived, anywhere:

- **GitHub → AWS**: OIDC. Actions presents a token proving it is this repo on
  `main`; AWS trades it for credentials that expire in an hour. There is no
  access key in a GitHub secret to leak or rotate.
- **Instance → ECR**: the instance's IAM role. No registry credential on the
  box.
- **Deployer → instance**: SSM Run Command. No SSH key, port 22 closed.

Deploys are `workflow_dispatch` with a typed confirmation rather than automatic
on push. Until there is enough coverage to trust a green build completely,
shipping should be a decision someone makes.

## Day to day

```bash
./deploy/deploy.sh                                    # deploy HEAD

aws ssm start-session --target $(cd infra && tofu output -raw instance_id)
  docker compose -f /opt/hamro/docker-compose.yml ps
  docker compose -f /opt/hamro/docker-compose.yml logs -f api
  systemctl list-timers hamro-backup.timer
  /opt/hamro/backup.sh                                # back up right now
```

There is no SSH and no key to lose — access is SSM Session Manager, authorised
by IAM. Port 22 is closed.

## Restoring

```bash
aws s3 ls s3://<backup-bucket>/postgres/            # find the dump
aws s3 cp s3://<backup-bucket>/postgres/<file> /tmp/dump.sql.gz

gunzip -c /tmp/dump.sql.gz | docker compose -f /opt/hamro/docker-compose.yml \
  exec -T postgres psql -U hamro -d hamro_school
```

The dump is taken with `--clean --if-exists`, so it restores over an existing
database. **Practise this before you need it.** A backup nobody has restored is
a hypothesis, not a backup.

## The seed does not belong here

`pnpm db:seed` builds a fictional school with 123 fictional students. It refuses
to run against a database that already has a `greenhill` school, but nothing
stops someone pointing it at production by mistake. Seed staging; never seed a
database a real school touches.

## Secrets

In SSM Parameter Store under `/hamro/<environment>/`, as SecureStrings. The
instance reads them at boot into `/opt/hamro/.env`, mode 600.

Rotating `JWT_ACCESS_SECRET` invalidates every access token in circulation;
rotating `JWT_REFRESH_SECRET` signs everybody out. Both are fine to do, as long
as you know that is what happens.

## When to outgrow this

- **A register save feels slow at 9am** → `t4g.small`, double the RAM
- **Constant swapping** (`vmstat 1`, `si`/`so` non-zero) → same
- **A second school signs** → move Postgres to RDS, keep the box for the app
- **Downtime during a deploy stops being acceptable** → second instance + ALB
- **A security review asks about the public IP** → private subnet + NAT

None of these are rewrites. They are all a variable and an apply.
