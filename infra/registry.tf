# The container registry.
#
# ECR rather than ghcr.io, despite ghcr being free. A private ghcr package
# needs a GitHub token stored on the instance to pull from; a public one would
# put our source in a public image. ECR authenticates with the instance's own
# IAM role — no credential is stored anywhere — and costs about $0.03/month for
# a 300 MB image. That is the right trade.

resource "aws_ecr_repository" "api" {
  name                 = "hamro-api"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "production"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Images are tagged per commit, so they pile up. Keep the last 10; that is
# several rollbacks' worth.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}
