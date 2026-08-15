# The API: ECR, a Fargate service, and a load balancer in front of it.

resource "aws_ecr_repository" "api" {
  name                 = "hamro-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Images are tagged with a commit SHA, so they accumulate. Keep the last 20.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 20 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/hamro/${var.environment}/api"
  retention_in_days = var.log_retention_days
}

# ── IAM ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by the ECS agent to pull the image and read the secrets, before the
# container starts.
resource "aws_iam_role" "task_execution" {
  name               = "${local.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["ssm:GetParameters"]
    resources = [
      aws_ssm_parameter.database_url.arn,
      aws_ssm_parameter.migration_database_url.arn,
      aws_ssm_parameter.jwt_access_secret.arn,
      aws_ssm_parameter.jwt_refresh_secret.arn,
    ]
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

# The role the application itself runs as. It needs nothing from AWS today —
# no S3, no SES, no Secrets Manager — so it gets nothing.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ── Load balancer ───────────────────────────────────────────────────────────

resource "aws_lb" "api" {
  name               = "${local.name}-api"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  idle_timeout               = 60
  enable_deletion_protection = var.environment == "production"
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 4000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  # /health checks Postgres too, so a task that cannot reach the database is
  # taken out of rotation instead of serving errors.
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Let in-flight requests finish on deploy. A teacher mid-save should get
  # their save.
  deregistration_delay = 30

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# DNS lives with the registrar, not Route 53, so validation records are added
# by hand — see docs/deployment.md. This waits until they resolve.
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ── The service ─────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled" # costs more than it is worth at one task
  }
}

locals {
  api_image = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"

  # Non-secret configuration. Secrets come from SSM, below.
  api_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "API_PORT", value = "4000" },
    { name = "API_HOST", value = "0.0.0.0" },
    # Exact origin, not a wildcard: the browser will not send credentials to a
    # wildcard origin, and the refresh cookie is the whole session.
    { name = "CORS_ORIGINS", value = "https://${var.web_hostname}" },
  ]

  api_secrets = [
    { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url.arn },
    { name = "JWT_ACCESS_SECRET", valueFrom = aws_ssm_parameter.jwt_access_secret.arn },
    { name = "JWT_REFRESH_SECRET", valueFrom = aws_ssm_parameter.jwt_refresh_secret.arn },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64" # cheaper per vCPU-hour, and the image is multi-arch
  }

  container_definitions = jsonencode([{
    name         = "api"
    image        = local.api_image
    essential    = true
    portMappings = [{ containerPort = 4000, protocol = "tcp" }]
    environment  = local.api_environment
    secrets      = local.api_secrets

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }

    # Give Fastify a moment to finish in-flight requests when ECS stops a task.
    stopTimeout = 30
  }])
}

# A separate task definition for `prisma migrate deploy`. Same image, different
# command, and the only place MIGRATION_DATABASE_URL is ever handed out.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name             = "migrate"
    image            = local.api_image
    essential        = true
    command          = ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"]
    workingDirectory = "/repo"

    environment = [{ name = "NODE_ENV", value = "production" }]
    secrets = [
      { name = "MIGRATION_DATABASE_URL", valueFrom = aws_ssm_parameter.migration_database_url.arn },
      # env.ts validates the whole environment at import time even for the CLI
      # path, so these have to be present and real.
      { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url.arn },
      { name = "JWT_ACCESS_SECRET", valueFrom = aws_ssm_parameter.jwt_access_secret.arn },
      { name = "JWT_REFRESH_SECRET", valueFrom = aws_ssm_parameter.jwt_refresh_secret.arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.tasks_in_private_subnets ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = !var.tasks_in_private_subnets
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }

  # Roll forward without dropping to zero capacity.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true # a bad image rolls itself back instead of staying broken
  }

  lifecycle {
    # CI updates the running task definition directly; Terraform should not
    # drag it back to whatever image_tag was last applied.
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.https]
}
