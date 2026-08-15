# Secrets.
#
# SSM Parameter Store rather than Secrets Manager: SecureString parameters are
# free, Secrets Manager is $0.40 per secret per month, and at this size the
# rotation features are not being used. Swap later if they ever are.
#
# ECS injects these into the task as environment variables. They are never in
# the image, never in the repo, and never in a task definition in plaintext.

resource "random_password" "jwt_access" {
  length  = 48
  special = true
}

resource "random_password" "jwt_refresh" {
  length  = 48
  special = true
}

locals {
  parameter_prefix = "/hamro/${var.environment}"
}

resource "aws_ssm_parameter" "database_url" {
  name        = "${local.parameter_prefix}/DATABASE_URL"
  description = "API connection. The RLS-restricted hamro_app role."
  type        = "SecureString"
  value       = local.app_database_url
}

resource "aws_ssm_parameter" "migration_database_url" {
  name        = "${local.parameter_prefix}/MIGRATION_DATABASE_URL"
  description = "Migrations and bootstrap only. Table owner, exempt from RLS."
  type        = "SecureString"
  value       = local.migration_database_url
}

resource "aws_ssm_parameter" "jwt_access_secret" {
  name        = "${local.parameter_prefix}/JWT_ACCESS_SECRET"
  description = "Rotating this invalidates every access token in circulation."
  type        = "SecureString"
  value       = random_password.jwt_access.result
}

resource "aws_ssm_parameter" "jwt_refresh_secret" {
  name        = "${local.parameter_prefix}/JWT_REFRESH_SECRET"
  description = "Rotating this signs everybody out."
  type        = "SecureString"
  value       = random_password.jwt_refresh.result
}

# The app-role password, kept so bootstrap-db.sh can create the role with it
# without Terraform state being the only copy.
resource "aws_ssm_parameter" "db_app_password" {
  name        = "${local.parameter_prefix}/DB_APP_PASSWORD"
  description = "Password for the hamro_app Postgres role."
  type        = "SecureString"
  value       = random_password.db_app.result
}
