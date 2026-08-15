variable "region" {
  description = "Where the stack runs. Mumbai is the closest region to the first customers; a school in Kathmandu feels the difference from us-east-1 on every register save."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "staging or production. Everything is named after it, so the two never collide."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "domain" {
  description = "Registrable domain. The web and API hostnames are subdomains of it, which is what keeps them same-site and the refresh cookie working."
  type        = string
  default     = "hamro.school"
}

variable "api_hostname" {
  description = "Hostname for the API."
  type        = string
  default     = "api.hamro.school"
}

variable "web_hostname" {
  description = "Hostname for the web app."
  type        = string
  default     = "app.hamro.school"
}

# ── Sizing ──────────────────────────────────────────────────────────────────
# Deliberately small. A school has hundreds of users, not hundreds of
# thousands, and the whole stack below runs at roughly $45/month.

variable "api_cpu" {
  description = "Fargate CPU units. 256 = 0.25 vCPU."
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "Fargate memory in MiB."
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Number of API tasks. Two gives you a zero-downtime deploy and survives an AZ going away; one is fine for staging."
  type        = number
  default     = 1
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "GB. gp3, grows automatically up to max_allocated_storage."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Days of automated backups. Schools keep records they are legally required to produce; do not set this to 0."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Blocks an accidental destroy of the database. Always true for production."
  type        = bool
  default     = false
}

variable "db_multi_az" {
  description = "Standby in a second AZ. Roughly doubles the database cost; worth it once a school depends on this."
  type        = bool
  default     = false
}

# ── Cost / security trade-off ───────────────────────────────────────────────

variable "tasks_in_private_subnets" {
  description = <<-EOT
    Put the API tasks in private subnets behind NAT gateways.

    False (the default) runs them in public subnets with a public IP. Their
    security group still accepts traffic only from the load balancer, so
    nothing can reach them directly — but the instance does have a routable
    address, which some security reviews will object to.

    True is the stricter arrangement and costs about $35/month per AZ for the
    NAT gateways. Switch it on when a customer's security questionnaire asks,
    or when there is revenue to pay for it.
  EOT
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "Container image tag to run. CI sets this to the commit SHA so a deploy is traceable to a commit."
  type        = string
  default     = "latest"
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}
