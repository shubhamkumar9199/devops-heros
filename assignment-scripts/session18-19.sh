#!/usr/bin/env bash
set -uxo pipefail
export PATH="$HOME/.local/bin:$PATH"
export AWS_EC2_METADATA_DISABLED=true
terraform version
for project in "session18-terraform-iac/terraform-s3-demo" "session19-cloud-terraform/mini-project"; do
 cd "$HOME/devops-heros/$project"
 terraform fmt -recursive
 terraform init -input=false
 timeout 180 terraform validate
 terraform providers
 timeout 90 terraform plan -input=false -no-color
 echo "Terraform plan exit status: $?"
done
