# Postgres.
#
# Two roles live inside this instance, as they do in development:
#   hamro      — the master user, owns the tables, runs migrations, exempt from RLS
#   hamro_app  — what the API connects as, subject to every RLS policy
#
# RDS only creates the master. `hamro_app` is created by infra/bootstrap-db.sh
# on first deploy, using the password generated below.

resource "random_password" "db_master" {
  length  = 40
  special = false # keeps the URL free of characters that need escaping
}

resource "random_password" "db_app" {
  length  = 40
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = local.name }
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg16"
  family = "postgres16"

  # Log anything slower than a second. Attendance for a section of 45 should
  # never come close; if it does, we want to know before a teacher does.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "hamro_school"
  username = "hamro"
  password = random_password.db_master.result
  port     = 5432

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az
  parameter_group_name   = aws_db_parameter_group.main.name

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "18:30-19:30" # ~midnight in Kathmandu, when nobody is taking a register
  maintenance_window      = "sun:19:45-sun:20:45"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  deletion_protection        = var.db_deletion_protection
  skip_final_snapshot        = var.environment != "production"
  final_snapshot_identifier  = var.environment == "production" ? "${local.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}" : null

  performance_insights_enabled    = false # not available on t4g.micro
  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = { Name = local.name }

  lifecycle {
    # The final snapshot name contains a timestamp, which would otherwise show
    # up as a change on every single plan.
    ignore_changes = [final_snapshot_identifier]
  }
}

locals {
  db_host = aws_db_instance.main.address
  db_name = aws_db_instance.main.db_name

  # What the API connects as. RLS applies to this role.
  app_database_url = "postgresql://hamro_app:${random_password.db_app.result}@${local.db_host}:5432/${local.db_name}?schema=public&sslmode=require"

  # What migrations connect as. Owns the tables, exempt from RLS, never serves
  # a request.
  migration_database_url = "postgresql://hamro:${random_password.db_master.result}@${local.db_host}:5432/${local.db_name}?schema=public&sslmode=require"
}
