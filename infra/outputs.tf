output "dns_record_to_create" {
  description = "Add this at Hostinger. Caddy gets a Let's Encrypt certificate on its own once the name resolves here."
  value = {
    type  = "A"
    name  = var.hostname
    value = aws_eip.main.public_ip
    ttl   = 300
  }
}

output "url" {
  value = "https://${var.hostname}"
}

output "instance_id" {
  description = "Shell in with: aws ssm start-session --target <this>"
  value       = aws_instance.main.id
}

output "public_ip" {
  value = aws_eip.main.public_ip
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "ssm_parameter_prefix" {
  value = local.parameter_prefix
}

output "estimated_monthly_usd" {
  description = "Rough, on-demand, excluding free tier. Verify against the AWS pricing page for your region before relying on it."
  value = {
    instance     = "~6.10 (t4g.micro)"
    ebs_30gb_gp3 = "~2.40"
    public_ipv4  = "~3.60"
    s3_backups   = "~0.10"
    total        = "~12.20"
  }
}

output "region" {
  value = var.region
}
