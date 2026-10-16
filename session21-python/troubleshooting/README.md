# Troubleshooting labs

Four deliberately broken workloads in their own namespace (`shelfwise-labs`, Pod
Security `restricted`), each diagnosed and fixed with plain `kubectl`. The real
output of every break → diagnose → fix run is in
[`../docs/evidence/labs.txt`](../docs/evidence/labs.txt).

```bash
kubectl apply -f troubleshooting/          # namespace + the four broken Deployments
kubectl -n shelfwise-labs get pods,svc,endpointslices
```

| # | Manifest | What you see | Where the cause shows up | Fix |
|---|---|---|---|---|
| 1 | [`01-image-tag-typo.yaml`](01-image-tag-typo.yaml) | `ErrImagePull` → `ImagePullBackOff` | `kubectl describe pod` → Events: `Failed to pull image "nginxinc/nginx-unprivileged:1.31.7-alpne3.24": rpc error: code = NotFound` | `kubectl set image deploy/lab-image web=nginxinc/nginx-unprivileged:1.31.7-alpine3.24` |
| 2 | [`02-service-selector.yaml`](02-service-selector.yaml) | Pods `Running 1/1`, but `wget http://lab-web` from another pod gets `Connection refused` | `kubectl get endpointslices -l kubernetes.io/service-name=lab-web` shows `<unset>` endpoints; the Service selector `app=lab-wbe` matches no pod label | `kubectl patch svc lab-web -p '{"spec":{"selector":{"app":"lab-web"}}}'` |
| 3 | [`03-readiness-port.yaml`](03-readiness-port.yaml) | `Running` but `READY 0/1`, never receives traffic | `kubectl describe pod` → `Readiness probe failed: ... connect: connection refused` on port 8081; nginx listens on 8080 | `kubectl patch deploy lab-ready --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8080}]'` |
| 4 | [`04-missing-secret.yaml`](04-missing-secret.yaml) | `CreateContainerConfigError`, no container ever starts | `kubectl describe pod` → `Error: secret "lab-db" not found` | `kubectl create secret generic lab-db --from-literal=password=...` — the kubelet retries the same pod on its own, no restart needed |

## The order I check things in

1. `kubectl get pods` — the STATUS column already names the stage that failed:
   pulling the image, creating the container, starting it, or passing probes.
2. `kubectl describe pod <name>` — the **Events** at the bottom say *why*.
3. `kubectl logs <pod> [--previous]` — only useful once the process has run.
4. For "Running but unreachable": compare `kubectl get svc <svc> -o wide` (selector)
   with `kubectl get pods --show-labels`, and check the EndpointSlice is not empty.

Clean up: `kubectl delete namespace shelfwise-labs`.
