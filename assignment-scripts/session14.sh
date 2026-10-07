#!/usr/bin/env bash
set -euxo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/devops-heros/session-14-kubernetes-troubleshooting"
kubectl create namespace troubleshooting --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n troubleshooting -f lab/deployment.yaml -f lab/service.yaml -f lab/broken-pod.yaml
kubectl apply -n troubleshooting -f scenarios/scenario-1-crashloop/broken.yaml -f scenarios/scenario-2-imagepull/broken.yaml -f scenarios/scenario-3-pending/broken.yaml -f scenarios/scenario-4-dns-failure/broken.yaml -f scenarios/scenario-5-oomkilled/broken.yaml
kubectl rollout status -n troubleshooting deployment/troubleshooting-app --timeout=180s
sleep 25
kubectl get pods -n troubleshooting -o wide
kubectl describe pod fail-3-pending-pod -n troubleshooting
kubectl logs fail-1-crashloop-pod -n troubleshooting || true
kubectl get events -n troubleshooting --sort-by=.lastTimestamp | tail -25
kubectl explain pod.spec.containers.resources
kubectl top pods -n troubleshooting || true
