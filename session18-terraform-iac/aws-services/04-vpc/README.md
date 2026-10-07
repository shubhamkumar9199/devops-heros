# VPC

- A VPC defines a private network; subnets divide its address range.
- Route tables choose the next hop. Public subnets use an Internet Gateway.
- Security Groups are stateful; subnet Network ACLs are stateless.
- Example: expose a web server while keeping its database in a private subnet.
