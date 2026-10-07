# DynamoDB and RDS

| Service | Data model | Suitable use |
|---|---|---|
| DynamoDB | Items indexed by partition and optional sort keys | Sessions, events and key-based lookups |
| RDS | Relational tables with SQL | Transactions, joins and structured records |

Use encryption, backups and restricted network access. RDS Multi-AZ supports failover; read replicas support read scaling.
