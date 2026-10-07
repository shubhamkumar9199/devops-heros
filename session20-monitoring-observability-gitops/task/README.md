# 20 — Monitoring and GitOps

Name: Shubham Kumar

Enrollment number: 24BCS10320

## Monitoring

Prometheus scrapes Node Exporter. The Grafana dashboard **Shubham system overview** displays CPU, memory and target availability.

| Signal | Information |
|---|---|
| Metrics | Numeric measurements and alert thresholds |
| Logs | Individual events and errors |
| Traces | Request paths and time spent across services |

```bash
bash assignment-scripts/session20.sh
curl http://localhost:9090/api/v1/targets
curl http://localhost:9090/api/v1/alerts
```

Result: targets were UP. Stopping Node Exporter triggered `NodeExporterUnavailable`; restarting it cleared the alert.

## GitOps

Git stores the desired configuration; Argo CD reconciles the cluster with it. Application and bootstrap manifests are in `gitops/` and point to this repository. Synchronization and self-healing are pending workflow execution. [GitOps workflow](../../.github/workflows/gitops-demo.yml).

## Screenshots

![Alert Firing](screenshots/alert-firing.png)

![Alert Recovered](screenshots/alert-recovered.png)

![System Overview](screenshots/system-overview.png)

![Targets](screenshots/targets.png)

## Command output

- [alert firing](logs/alert-firing.log)
- [alert recovered](logs/alert-recovered.log)
- [monitoring first attempt](logs/monitoring-first-attempt.log)
- [monitoring](logs/monitoring.log)
