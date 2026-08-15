output "dns_records_to_create" {
  description = "Add these at your registrar's DNS. The two _acm records prove you own the names; the other two point them at AWS."
  value = {
    acm_validation_api = {
      for option in aws_acm_certificate.api.domain_validation_options :
      option.domain_name => { type = option.resource_record_type, name = option.resource_record_name, value = option.resource_record_value }
    }
    acm_validation_web = {
      for option in aws_acm_certificate.web.domain_validation_options :
      option.domain_name => { type = option.resource_record_type, name = option.resource_record_name, value = option.resource_record_value }
    }
    api = {
      type  = "CNAME"
      name  = var.api_hostname
      value = aws_lb.api.dns_name
    }
    web = {
      type  = "CNAME"
      name  = var.web_hostname
      value = aws_cloudfront_distribution.web.domain_name
    }
  }
}

output "api_url" {
  value = "https://${var.api_hostname}"
}

output "web_url" {
  value = "https://${var.web_hostname}"
}

output "ecr_repository_url" {
  description = "Where CI pushes the API image."
  value       = aws_ecr_repository.api.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service" {
  value = aws_ecs_service.api.name
}

output "migrate_task_definition" {
  description = "Run this as a one-off task to apply migrations."
  value       = aws_ecs_task_definition.migrate.family
}

output "web_bucket" {
  description = "Where the built web app is uploaded."
  value       = aws_s3_bucket.web.bucket
}

output "cloudfront_distribution_id" {
  description = "Needed to invalidate the cache after a web deploy."
  value       = aws_cloudfront_distribution.web.id
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

# Subnets and security group for running one-off tasks (migrations, bootstrap)
# from the CLI or CI.
output "task_subnet_ids" {
  value = var.tasks_in_private_subnets ? aws_subnet.private[*].id : aws_subnet.public[*].id
}

output "task_security_group_id" {
  value = aws_security_group.api.id
}

output "task_assign_public_ip" {
  value = !var.tasks_in_private_subnets
}

# Deliberately not an output: the database passwords and JWT secrets. They are
# in SSM under /hamro/<environment>/ and in Terraform state. Printing them at
# the end of every apply puts them in terminal scrollback and CI logs.
output "ssm_parameter_prefix" {
  value = local.parameter_prefix
}
