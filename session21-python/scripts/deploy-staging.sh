#!/usr/bin/env bash
# Install or upgrade the staging release with Helm directly (no Argo CD):
#   scripts/deploy-staging.sh <commit-sha>      (defaults to the tag Argo CD runs)
set -euo pipefail
cd "$(dirname "$0")/.."
sha="${1:-$(sed -n 's/^ *tag: "\(.*\)"/\1/p' gitops/values-gitops.yaml | head -1)}"
[ -n "$sha" ] || { echo "usage: $0 <commit-sha>" >&2; exit 1; }

helm upgrade --install shelfwise ./helm/shelfwise -n shelfwise-staging \
  -f helm/shelfwise/values-staging.yaml \
  --set backend.image.tag="$sha" --set frontend.image.tag="$sha" \
  --wait --timeout 6m
helm list -n shelfwise-staging
kubectl -n shelfwise-staging get pods,svc,ingress
