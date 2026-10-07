#!/usr/bin/env bash
set -euxo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/devops-heros/session20-monitoring-observability-gitops/gitops"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
if test "${ARGO_SKIP_INSTALL:-0}" != 1; then
 kubectl apply -n argocd --server-side --force-conflicts --request-timeout=120s -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.4/manifests/core-install.yaml
fi
# This exercise uses one Application, so the optional ApplicationSet controller is unnecessary.
kubectl scale deployment/argocd-applicationset-controller -n argocd --replicas=0
kubectl rollout status deployment/argocd-repo-server -n argocd --timeout=300s
kubectl rollout status statefulset/argocd-application-controller -n argocd --timeout=300s
kubectl apply -f bootstrap/project.yaml -f bootstrap/application.yaml
for attempt in $(seq 1 60); do
 status=$(kubectl get application session20-mini -n argocd -o jsonpath='{.status.sync.status}')
 test "$status" = Synced && break
 sleep 5
done
kubectl get application -n argocd
kubectl rollout status deployment/session20-mini -n session20 --timeout=180s
kubectl get pods,svc -n session20
kubectl scale deployment/session20-mini -n session20 --replicas=1
for attempt in $(seq 1 40); do
 replicas=$(kubectl get deployment session20-mini -n session20 -o jsonpath='{.spec.replicas}')
 test "$replicas" = 2 && break
 sleep 3
done
test "$replicas" = 2
kubectl get application -n argocd
kubectl rollout status deployment/session20-mini -n session20 --timeout=180s
kubectl get deployment/session20-mini -n session20
kubectl get application/session20-mini -n argocd -o jsonpath='{.status.sync.revision}'
