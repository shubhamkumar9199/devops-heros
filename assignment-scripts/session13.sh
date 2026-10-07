#!/usr/bin/env bash
set -euxo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/devops-heros/session-13-storage-hpa-probes"
minikube addons enable metrics-server
kubectl apply -f mini-project/namespace.yaml
kubectl apply -f mini-project/pvc.yaml -f mini-project/deployment.yaml -f mini-project/service.yaml -f mini-project/hpa.yaml
kubectl rollout status deployment/web-app -n production-webapp --timeout=180s
kubectl get pvc,pods,svc,hpa -n production-webapp
kubectl exec -n production-webapp deployment/web-app -- sh -c 'echo "Shubham persistent storage" >/data/assignment.txt; cat /data/assignment.txt'
kubectl apply -f volumes/emptydir-pod.yaml -f volumes/hostpath-pod.yaml
kubectl wait --for=condition=Ready pod/hostpath-demo --timeout=120s
kubectl exec hostpath-demo -- sh -c 'echo "hostPath persistence" >/shubham-data/assignment.txt; cat /shubham-data/assignment.txt'
kubectl describe deployment/web-app -n production-webapp
