variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Name prefix for resources and the Project tag."
  type        = string
  default     = "shelfwise"
}

variable "environment" {
  description = "Environment tag (dev, staging, prod)."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "Address range of the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "One public subnet per availability zone (load balancers, NAT gateway)."
  type        = list(string)
  default     = ["10.20.0.0/20", "10.20.16.0/20"]

  validation {
    condition     = length(var.public_subnet_cidrs) >= 2
    error_message = "EKS needs subnets in at least two availability zones."
  }
}

variable "private_subnet_cidrs" {
  description = "One private subnet per availability zone (worker nodes and pods)."
  type        = list(string)
  default     = ["10.20.128.0/19", "10.20.160.0/19"]

  validation {
    condition     = length(var.private_subnet_cidrs) >= 2
    error_message = "EKS needs subnets in at least two availability zones."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. Keep it inside standard support (extended support costs 6x)."
  type        = string
  default     = "1.35"
}

variable "api_allowed_cidrs" {
  description = "CIDRs allowed to reach the public EKS API endpoint, e.g. [\"203.0.113.10/32\"] for your own IP."
  type        = list(string)

  validation {
    condition     = length(var.api_allowed_cidrs) > 0
    error_message = "Name at least one CIDR (your public IP as /32) that may reach the cluster API."
  }
}

variable "node_instance_types" {
  description = "Instance types for the managed node group (t3.medium = 2 vCPU, 4 GiB)."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.node_capacity_type)
    error_message = "node_capacity_type must be ON_DEMAND or SPOT."
  }
}

variable "node_desired_size" {
  description = "Worker nodes to start with."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Fewest worker nodes."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Most worker nodes."
  type        = number
  default     = 3
}

variable "node_disk_size_gb" {
  description = "Root volume size of each worker node."
  type        = number
  default     = 20
}

variable "enable_nat_gateway" {
  description = "One NAT gateway so private nodes can pull images. Without it nodes have no internet access."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "How long to keep EKS control-plane audit logs in CloudWatch."
  type        = number
  default     = 3
}
