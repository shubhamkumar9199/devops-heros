#!/usr/bin/env bash
# Load 60 days of demo lending history into a running deployment (only if empty):
#   scripts/seed.sh                 # namespace shelfwise
#   NS=shelfwise-staging scripts/seed.sh --reset
set -euo pipefail
ns="${NS:-shelfwise}"
kubectl -n "$ns" exec deploy/shelfwise-backend -- python -m app.seed "$@"
