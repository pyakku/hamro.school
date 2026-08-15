variable "region" {
  description = <<-EOT
    Where the box lives.

    us-east-1 is the cheapest region and saves roughly $0.30/month over Mumbai.
    It also adds ~250ms round-trip for users in Nepal and India, on every
    request, including the attendance save that has to feel instant on a phone.
    ap-south-1 is the right call until there are customers somewhere else.
  EOT
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  type    = string
  default = "production"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "instance_type" {
  description = <<-EOT
    t4g.micro: 2 burstable vCPU, 1 GB RAM, ARM. ~$6/month.

    One gigabyte is genuinely tight for Postgres plus Node plus Caddy. It is
    made to fit with a 2 GB swap file, a small shared_buffers and a capped Node
    heap — see deploy/docker-compose.yml. It will run a demo and a first school
    comfortably. When a second school lands, or a register save starts feeling
    slow at 9am, move to t4g.small: double the RAM for about $6 more, and it is
    a stop/change/start rather than a migration.
  EOT
  type        = string
  default     = "t4g.micro"
}

variable "root_volume_gb" {
  description = "Holds the OS, Docker images and the Postgres data directory."
  type        = number
  default     = 30
}

variable "hostname" {
  description = "What the whole product answers on. Caddy serves the web app and proxies /api to the API from this one name, so there is no cross-origin anything."
  type        = string
  default     = "app.hamro.school"
}

variable "base_domain" {
  description = "Schools live at <slug>.<base_domain>. A wildcard A record must point here, and Caddy issues a certificate per school on demand."
  type        = string
  default     = "hamro.school"
}

variable "acme_email" {
  description = "Let's Encrypt sends expiry warnings here. Caddy renews automatically; this is the safety net."
  type        = string
  default     = "pyakku@gmail.com"
}

variable "backup_retention_days" {
  description = "How long nightly database dumps live in S3. Self-hosted Postgres has no automated backups — this is the only thing standing between a dead instance and a school's records."
  type        = number
  default     = 30
}

variable "ssh_ingress_cidr" {
  description = "Leave empty. Access is via SSM Session Manager, which needs no open port and no key to lose. Set a CIDR only to debug something SSM cannot reach."
  type        = string
  default     = ""
}

variable "existing_eip_allocation_id" {
  description = <<-EOT
    Adopt an Elastic IP you already have, e.g. "eipalloc-0abc123".

    AWS bills every public IPv4 address at ~$3.60/month whether it is attached
    to anything or not, so an idle Elastic IP is already costing you the same
    as the new one this stack would otherwise allocate. Reusing it is free;
    releasing it and allocating another is a wash.

    Leave empty to allocate a new one.
  EOT
  type        = string
  default     = ""
}
