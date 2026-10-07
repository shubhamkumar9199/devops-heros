#!/usr/bin/env bash
set -euxo pipefail
export COMPOSE_PROJECT_NAME=shubham-monitoring
cd "$HOME/devops-heros/session20-monitoring-observability-gitops/monitoring"
docker compose up -d
for attempt in $(seq 1 30); do curl --max-time 10 -fsS http://localhost:9090/-/ready && break || sleep 2; done
curl --max-time 15 -fsS http://localhost:9090/-/ready
docker compose ps
curl --max-time 15 -fsS http://localhost:9090/api/v1/targets | python3 -m json.tool
curl --max-time 15 -fsSG http://localhost:9090/api/v1/query --data-urlencode 'query=up' | python3 -m json.tool
for attempt in $(seq 1 30); do curl --max-time 10 -fsS http://localhost:3001/api/health && break || sleep 2; done
curl --max-time 15 -fsS http://localhost:3001/api/health
