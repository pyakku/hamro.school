# One t4g.micro runs the lot: Caddy for TLS and static files, the API, and
# Postgres. No load balancer, no managed database, no NAT gateway — those are
# roughly $60/month of AWS that this product does not need until it has
# customers.
#
#   t4g.micro          ~$6.10
#   30 GB gp3          ~$2.40
#   public IPv4        ~$3.60
#   S3 backups         ~$0.10
#   ─────────────────────────
#                      ~$12/month
#
# What is given up, honestly: a deploy has a few seconds of downtime, an
# instance failure is a restore-from-backup rather than a failover, and the
# database competes with the API for 1 GB of RAM. All three are fine now and
# all three are worth revisiting the day a school depends on this.

locals {
  name = "hamro-${var.environment}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

# ── Network: one public subnet, no NAT, nothing clever ──────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ── Security group ──────────────────────────────────────────────────────────
#
# 80 and 443 only. Postgres listens on the Docker bridge, not on the host, so
# it is not reachable from outside the box at all. Port 22 stays shut: shell
# access is SSM Session Manager, which needs no open port and no private key
# that can be lost or committed.

resource "aws_security_group" "instance" {
  name        = local.name
  description = "hamro.school single-instance stack"
  vpc_id      = aws_vpc.main.id

  tags = { Name = local.name }
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.instance.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.instance.id
  description       = "HTTP: the Let's Encrypt challenge, then a redirect to HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  count = var.ssh_ingress_cidr == "" ? 0 : 1

  security_group_id = aws_security_group.instance.id
  description       = "SSH, temporarily"
  cidr_ipv4         = var.ssh_ingress_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.instance.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ── Backups ─────────────────────────────────────────────────────────────────
#
# The one thing that must not be skipped when dropping RDS. A nightly pg_dump
# lands here; without it, a lost instance is a lost school.

resource "aws_s3_bucket" "backups" {
  bucket = "${local.name}-backups-${data.aws_caller_identity.current.account_id}"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-dumps"
    status = "Enabled"

    filter {}

    expiration {
      days = var.backup_retention_days
    }
  }
}

# ── Instance role ───────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# Shell access without opening a port or handing out a key.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  statement {
    sid       = "BackupsAndArtifacts"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
  }

  # Pull the application image. GetAuthorizationToken is account-wide by
  # design; the pull itself is scoped to our one repository.
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
    resources = [aws_ecr_repository.api.arn]
  }

  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/hamro/${var.environment}/*"]
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "hamro"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.name}-instance"
  role = aws_iam_role.instance.name
}

# ── Secrets ─────────────────────────────────────────────────────────────────
#
# SecureString parameters are free; Secrets Manager is $0.40 each per month.
# The instance reads these at boot and writes them to an env file that only
# root can read.

resource "random_password" "db_owner" {
  length  = 40
  special = false
}

resource "random_password" "db_app" {
  length  = 40
  special = false
}

resource "random_password" "jwt_access" {
  length  = 48
  special = false
}

resource "random_password" "jwt_refresh" {
  length  = 48
  special = false
}

locals {
  parameter_prefix = "/hamro/${var.environment}"

  parameters = {
    POSTGRES_PASSWORD      = random_password.db_owner.result
    APP_DB_PASSWORD        = random_password.db_app.result
    JWT_ACCESS_SECRET      = random_password.jwt_access.result
    JWT_REFRESH_SECRET     = random_password.jwt_refresh.result
    DATABASE_URL           = "postgresql://hamro_app:${random_password.db_app.result}@postgres:5432/hamro_school?schema=public"
    MIGRATION_DATABASE_URL = "postgresql://hamro:${random_password.db_owner.result}@postgres:5432/hamro_school?schema=public"
  }
}

resource "aws_ssm_parameter" "config" {
  for_each = local.parameters

  name  = "${local.parameter_prefix}/${each.key}"
  type  = "SecureString"
  value = each.value
}

# ── The instance ────────────────────────────────────────────────────────────

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64"
}

resource "aws_instance" "main" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.instance.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
    tags        = { Name = local.name }
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
  }

  user_data_replace_on_change = false
  user_data = templatefile("${path.module}/user-data.sh", {
    region           = var.region
    environment      = var.environment
    hostname         = var.hostname
    acme_email       = var.acme_email
    backup_bucket    = aws_s3_bucket.backups.bucket
    parameter_prefix = local.parameter_prefix
  })

  tags = { Name = local.name }

  lifecycle {
    # Changing user_data should not silently rebuild the box the database
    # lives on. Re-run it deliberately over SSM instead.
    ignore_changes = [ami, user_data]
  }
}

# A stable address, so the DNS record survives a stop/start.
#
# Every public IPv4 address is billed at ~$3.60/month whether it is attached to
# anything or not, so an Elastic IP already sitting in the account is worth
# reusing rather than releasing and allocating a fresh one at the same price.
# Set existing_eip_allocation_id to adopt one.

resource "aws_eip" "main" {
  count  = var.existing_eip_allocation_id == "" ? 1 : 0
  domain = "vpc"

  tags = { Name = local.name }
}

data "aws_eip" "existing" {
  count = var.existing_eip_allocation_id == "" ? 0 : 1
  id    = var.existing_eip_allocation_id
}

resource "aws_eip_association" "main" {
  instance_id   = aws_instance.main.id
  allocation_id = local.eip_allocation_id
}

locals {
  eip_allocation_id = var.existing_eip_allocation_id == "" ? aws_eip.main[0].id : var.existing_eip_allocation_id
  public_ip         = var.existing_eip_allocation_id == "" ? aws_eip.main[0].public_ip : data.aws_eip.existing[0].public_ip
}
