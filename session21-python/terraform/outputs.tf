output "region" {
  value = var.region
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "availability_zones" {
  value = local.azs
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "nat_gateway_public_ip" {
  value = var.enable_nat_gateway ? aws_eip.nat[0].public_ip : null
}

output "cluster_name" {
  value = aws_eks_cluster.main.name
}

output "cluster_version" {
  value = aws_eks_cluster.main.version
}

output "cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "node_group" {
  value = {
    name           = aws_eks_node_group.main.node_group_name
    instance_types = aws_eks_node_group.main.instance_types
    desired_size   = aws_eks_node_group.main.scaling_config[0].desired_size
  }
}

output "configure_kubectl" {
  description = "Run this after apply to point kubectl at the cluster."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.main.name}"
}
