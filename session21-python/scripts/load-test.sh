#!/usr/bin/env bash
# Drive API traffic through the Ingress and watch the HPA react:
#   scripts/load-test.sh [seconds=240] [workers=16]
# Prints the HPA every 15 s; afterwards the backend scales back down to 2.
set -euo pipefail
duration="${1:-240}"
workers="${2:-16}"
host="${HOST:-shelfwise.local}"
base="${BASE:-http://127.0.0.1}"
ns="${NS:-shelfwise}"
end=$(( $(date +%s) + duration ))
paths=(/api/books "/api/books?q=the" /api/stats "/api/loans?status=overdue" /api/members /api/activity "/api/holds")

worker() {
  while [ "$(date +%s)" -lt "$end" ]; do
    for p in "${paths[@]}"; do
      curl -s -o /dev/null --max-time 5 -H "Host: $host" "$base$p" || true
    done
  done
}

echo "load: $workers workers for ${duration}s against $base (Host: $host)"
pids=()
for _ in $(seq "$workers"); do worker & pids+=($!); done
trap 'kill "${pids[@]}" 2> /dev/null || true' EXIT

while [ "$(date +%s)" -lt "$end" ]; do
  printf '%s  ' "$(date +%H:%M:%S)"
  kubectl -n "$ns" get hpa shelfwise-backend --no-headers \
    -o custom-columns='CPU:.status.currentMetrics[0].resource.current.averageUtilization,TARGET:.spec.metrics[0].resource.target.averageUtilization,REPLICAS:.status.currentReplicas,DESIRED:.status.desiredReplicas' \
    | awk '{printf "cpu=%s%% (target %s%%)  replicas=%s  desired=%s\n", $1, $2, $3, $4}'
  sleep 15
done
wait
echo "load finished; watch the scale-down with: kubectl -n $ns get hpa -w"
