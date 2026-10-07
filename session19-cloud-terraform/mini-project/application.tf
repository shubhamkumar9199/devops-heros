data "aws_ami" "linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
resource "aws_instance" "web" {
  ami                    = data.aws_ami.linux.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  depends_on             = [aws_route_table_association.public]
  metadata_options {
    http_tokens = "required"
  }
  user_data = <<-SCRIPT
    #!/bin/bash
    dnf install -y nginx
    echo '<h1>Hello from Shubham DevOps Terraform</h1>' > /usr/share/nginx/html/index.html
    systemctl enable --now nginx
  SCRIPT
  tags      = { Name = "shubham-session19-web" }
}
resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "shubham-session19-"
  tags          = { Name = "shubham-session19-artifacts" }
}
resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
output "website_url" {
  value = "http://${aws_instance.web.public_ip}"
}
output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.id
}
