terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.68"
    }
  }

  # State stays local for this classroom project (git-ignored). For a team you
  # would use an S3 backend with native locking:
  # backend "s3" {
  #   bucket       = "shelfwise-tfstate-<account-id>"
  #   key          = "eks/terraform.tfstate"
  #   region       = "ap-south-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "github.com/shubhamkumar9199/devops-heros"
    }
  }
}
