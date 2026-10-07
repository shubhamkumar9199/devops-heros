#!/usr/bin/env bash
set -euxo pipefail
export PATH="$HOME/.local/bin:$PATH"
kubectl exec -n production-webapp deployment/web-app -- sh -c 'yes >/dev/null & load_pid=$!; sleep 120; kill "$load_pid"' &
load_job=$!
for attempt in $(seq 1 8); do
  kubectl top pods -n production-webapp || true
  kubectl get hpa,pods -n production-webapp
  sleep 15
done
wait "$load_job"
kubectl describe hpa web-app-hpa -n production-webapp
