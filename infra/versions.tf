terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in S3 once the bucket exists. See docs/deployment.md — the very
  # first apply runs with local state and then migrates, because the bucket
  # holding the state cannot be created by the state it holds.
  # backend "s3" {
  #   bucket       = "hamro-school-tfstate"
  #   key          = "staging/terraform.tfstate"
  #   region       = "ap-south-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "hamro.school"
      Environment = var.environment
      ManagedBy   = "opentofu"
    }
  }
}

# CloudFront will only accept a certificate from us-east-1, wherever the rest
# of the stack lives.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "hamro.school"
      Environment = var.environment
      ManagedBy   = "opentofu"
    }
  }
}
