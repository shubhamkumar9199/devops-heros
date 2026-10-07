#!/usr/bin/env bash
set -euxo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/devops-heros/session-14-kubernetes-troubleshooting"
kubectl delete -n troubleshooting pod project-broken-pod fail-1-crashloop-pod fail-2-imagepull-pod fail-3-pending-pod fail-4-dns-failure-pod fail-5-oomkilled-pod
kubectl apply -n troubleshooting -f fixed/
kubectl wait -n troubleshooting --for=condition=Ready pod --all --timeout=180s
kubectl get pods,svc,endpoints -n troubleshooting -o wide
kubectl exec -n troubleshooting fail-4-dns-failure-pod -- wget -qO- http://troubleshooting-service
kubectl logs -n troubleshooting fail-1-crashloop-pod
kubectl patch svc troubleshooting-service -n troubleshooting --type=merge -p '{"spec":{"selector":{"app":"wrong-label"}}}'
kubectl get endpoints troubleshooting-service -n troubleshooting
kubectl get pods -n troubleshooting --show-labels
kubectl patch svc troubleshooting-service -n troubleshooting --type=merge -p '{"spec":{"selector":{"app":"troubleshooting-app"}}}'
kubectl get endpoints troubleshooting-service -n troubleshooting
kubectl exec -n troubleshooting fail-4-dns-failure-pod -- nslookup troubleshooting-service.troubleshooting.svc.cluster.local
