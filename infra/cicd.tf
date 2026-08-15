# GitHub Actions deploys without any long-lived AWS credentials.
#
# OIDC: Actions presents a short-lived token that proves which repository and
# which branch is asking, and AWS trades it for temporary credentials. There is
# no access key in a GitHub secret to leak, rotate, or find in a git history
# two years from now.

variable "github_repository" {
  description = "owner/repo allowed to deploy."
  type        = string
  default     = "pyakku/hamro.school"
}

variable "github_owner_id" {
  description = "Numeric GitHub owner id, from the OIDC subject claim."
  type        = string
  default     = "16604460"
}

variable "github_repository_id" {
  description = "Numeric GitHub repository id, from the OIDC subject claim."
  type        = string
  default     = "1333347021"
}

locals {
  # pyakku@16604460/hamro.school@1333347021
  github_subject = join("/", [
    "${split("/", var.github_repository)[0]}@${var.github_owner_id}",
    "${split("/", var.github_repository)[1]}@${var.github_repository_id}",
  ])
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

variable "create_github_oidc_provider" {
  description = "False if the account already has the GitHub OIDC provider — there can only be one per account, and adding a second fails."
  type        = bool
  default     = true
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  github_oidc_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only this repository, and only the production environment or main.
    #
    # GitHub sends an immutable subject that embeds the numeric owner and
    # repository ids — `repo:owner@16604460/name@1333347021:...` — rather than
    # the `repo:owner/name:...` in most documentation. Matching the ids is
    # stricter than matching the names: it survives a rename, and it cannot be
    # impersonated by someone who registers the name after a transfer.
    #
    # Both the environment and ref forms are listed because a job that names an
    # `environment:` gets the former and one that does not gets the latter.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${local.github_subject}:environment:production",
        "repo:${local.github_subject}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  # Find the instance to deploy to. Read-only and harmless.
  statement {
    sid       = "FindInstance"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  # Push the image.
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.api.arn]
  }

  # Upload the web bundle and the compose files.
  statement {
    sid       = "PutArtifacts"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/artifacts/*"]
  }

  # Drive the deploy. Scoped to this one instance and to the shell-script
  # document, so this role cannot run commands on anything else in the account.
  statement {
    sid     = "RunDeploy"
    actions = ["ssm:SendCommand"]
    resources = [
      aws_instance.main.arn,
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
    ]
  }

  statement {
    sid       = "ReadCommandOutput"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:ListCommands"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

output "github_actions_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE repository variable in GitHub."
  value       = aws_iam_role.github_deploy.arn
}
