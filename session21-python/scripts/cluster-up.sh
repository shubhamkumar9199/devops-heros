#!/usr/bin/env bash
# Build the local platform on kind, idempotently (safe to re-run):
#   kind cluster -> metrics-server -> Traefik -> Prometheus/Grafana -> Argo CD
#   -> app namespaces + database Secrets -> the Argo CD Application.
# Argo CD then deploys ShelfWise from Git (helm/shelfwise + gitops/values-gitops.yaml).
#
#   scripts/cluster-up.sh
#   GHCR_PULL_TOKEN=<token with read:packages> scripts/cluster-up.sh   # if the images are private
#   SKIP_APP=1 scripts/cluster-up.sh    # platform only, without the Argo CD Application
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=shelfwise
TRAEFIK_CHART=41.7.1
KPS_CHART=92.8.0
ARGOCD_CHART=10.10.5
METRICS_SERVER_CHART=3.14.0

for tool in kind kubectl helm openssl; do
  command -v "$tool" > /dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "kind cluster '$CLUSTER'"
if ! kind get clusters 2> /dev/null | grep -qx "$CLUSTER"; then
  kind create cluster --config k8s/kind-cluster.yaml --wait 180s
fi
kubectl config use-context "kind-$CLUSTER" > /dev/null
kubectl get nodes -o wide

step "Helm repositories"
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update > /dev/null
helm repo add traefik https://traefik.github.io/charts --force-update > /dev/null
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update > /dev/null
helm repo add argo https://argoproj.github.io/argo-helm --force-update > /dev/null
helm repo update > /dev/null

step "metrics-server (CPU metrics for the HPA)"
helm upgrade --install metrics-server metrics-server/metrics-server --version "$METRICS_SERVER_CHART" \
  -n kube-system -f monitoring/metrics-server-values.yaml --wait --timeout 5m

step "Traefik ingress controller (127.0.0.1:80/443)"
helm upgrade --install traefik traefik/traefik --version "$TRAEFIK_CHART" \
  -n traefik --create-namespace -f k8s/traefik-values.yaml --wait --timeout 5m

step "kube-prometheus-stack (Prometheus, Grafana, Alertmanager)"
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f - > /dev/null
if ! kubectl -n monitoring get secret grafana-admin > /dev/null 2>&1; then
  kubectl -n monitoring create secret generic grafana-admin \
    --from-literal=admin-user=admin --from-literal=admin-password="$(openssl rand -base64 18)"
fi
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack --version "$KPS_CHART" \
  -n monitoring -f monitoring/kube-prometheus-stack-values.yaml --wait --timeout 15m

step "Argo CD"
helm upgrade --install argocd argo/argo-cd --version "$ARGOCD_CHART" \
  -n argocd --create-namespace -f gitops/argocd-values.yaml --wait --timeout 10m

step "Application namespaces and database Secrets (generated here, never stored in Git)"
kubectl apply -f k8s/namespace.yaml -f k8s/namespace-staging.yaml
for ns in shelfwise shelfwise-staging; do
  if ! kubectl -n "$ns" get secret shelfwise-db > /dev/null 2>&1; then
    kubectl -n "$ns" create secret generic shelfwise-db --from-literal=password="$(openssl rand -hex 24)"
  fi
  if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
    kubectl -n "$ns" create secret docker-registry ghcr --docker-server=ghcr.io \
      --docker-username="${GHCR_PULL_USER:-shubhamkumar9199}" --docker-password="$GHCR_PULL_TOKEN" \
      --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n "$ns" patch serviceaccount default -p '{"imagePullSecrets":[{"name":"ghcr"}]}'
  fi
done

if [ "${SKIP_APP:-0}" != 1 ]; then
  step "Argo CD Application (GitOps: Git is the source of truth from here on)"
  kubectl apply -f gitops/argocd-application.yaml
fi

cat << 'EOF'

Done. Add the local hostnames once (needs sudo):
  echo "127.0.0.1 shelfwise.local staging.shelfwise.local grafana.shelfwise.local prometheus.shelfwise.local argocd.shelfwise.local" | sudo tee -a /etc/hosts

  App          http://shelfwise.local            (API docs: /api/docs)
  Staging      http://staging.shelfwise.local    (scripts/deploy-staging.sh <sha>)
  Argo CD      http://argocd.shelfwise.local     user admin, password:
                 kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
  Grafana      http://grafana.shelfwise.local    user admin, password:
                 kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d
  Prometheus   http://prometheus.shelfwise.local/targets

Watch the rollout:  kubectl -n argocd get application shelfwise -w
Demo data:          scripts/seed.sh
EOF
