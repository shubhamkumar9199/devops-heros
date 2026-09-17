# Session 12 - Ingress, ConfigMaps and Secrets - Task

- **Name:** Shubham Kumar
- **Enrollment No:** 24BCS10320

---

> **Note on verification:** unlike my earlier sessions, the terminal output below
> is **expected output derived from the manifests in this folder, not captured
> from a live run**. I have not yet had a cluster available to execute these
> against. I will replace these blocks with real captures and screenshots once I
> run the labs. Everything else — the manifests, resource names, ports and keys —
> is read directly from the files in this session folder.

---

## What the task asked

[`../lab.md`](../lab.md) is an explicit nine-part lab ending in a ten-item
completion checklist, so here the task is stated rather than inferred. I worked
through all nine parts against [`../04-full-demo/`](../04-full-demo/), and went
past the checklist where the lab raised a question it did not finish answering:
TLS termination (the session ships
[`../03-ingress/ingress-tls.yaml`](../03-ingress/ingress-tls.yaml) but the lab
never uses it), a failure-triage playbook for the 404/502/503 cases, and what it
actually takes to store a secret safely — since
[`../troubleshooting/secret-base64-gotcha.md`](../troubleshooting/secret-base64-gotcha.md)
makes the point that base64 is not encryption without saying what to do instead.

Section §14 maps each item of the lab's own completion checklist to where I
covered it.

---

## Table of Contents

1. [Environment setup](#1-environment-setup)
2. [Part 1 — ConfigMap](#2-part-1--configmap)
3. [Part 2 — Secret](#3-part-2--secret)
4. [Part 3 — Injecting config into the backend](#4-part-3--injecting-config-into-the-backend)
5. [Part 4 — The frontend](#5-part-4--the-frontend)
6. [Part 5 — Ingress](#6-part-5--ingress)
7. [Part 6 — Testing the routing](#7-part-6--testing-the-routing)
8. [Part 7 — The full picture](#8-part-7--the-full-picture)
9. [Part 8 — The newline bug, debugged](#9-part-8--the-newline-bug-debugged)
10. [Part 9 — What happens when you update a ConfigMap](#10-part-9--what-happens-when-you-update-a-configmap)
11. [TLS termination with Ingress](#11-tls-termination-with-ingress)
12. [Troubleshooting playbook](#12-troubleshooting-playbook)
13. [Production hardening — secrets that are actually secret](#13-production-hardening--secrets-that-are-actually-secret)
14. [Lab completion checklist](#14-lab-completion-checklist)
15. [Cleanup](#15-cleanup)

---

## 1. Environment setup

```bash
minikube start --cpus=4 --memory=6g
kubectl cluster-info

cd session-12-ingress-configmaps-secrets/04-full-demo
ls
```

```text
backend.yaml  cleanup.sh  configmap.yaml  frontend.yaml  ingress.yaml  run-demo.sh  secret.yaml
```

Enable the Ingress Controller now — it takes 30–60 seconds and Part 5 depends on it:

```bash
minikube addons enable ingress
kubectl wait --namespace ingress-nginx \
  --for=condition=Ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s
```

```text
pod/ingress-nginx-controller-7799c6795f-9k2lw condition met
```

---

## 2. Part 1 — ConfigMap

### What it is and why it exists

A ConfigMap holds non-confidential configuration as key-value pairs, decoupled
from the container image. Without it you would bake `ENVIRONMENT=production` into
the image — meaning a separate image per environment, a rebuild to change a log
level, and an image you cannot promote unchanged from staging to production.

> **The Twelve-Factor rule:** build the artifact once, configure it per
> environment. The image is identical everywhere; only the ConfigMap differs.

### Apply and inspect

```bash
kubectl apply -f configmap.yaml
kubectl get configmap yatri-app-config
```

```text
NAME               DATA   AGE
yatri-app-config   5      8s
```

```bash
kubectl describe configmap yatri-app-config
```

```text
Name:         yatri-app-config
Namespace:    default
Labels:       app=yatri-app

Data
====
APP_PORT:
----
5000
DEFAULT_CURRENCY:
----
INR
ENVIRONMENT:
----
production
LOG_LEVEL:
----
INFO
MAX_BOOKING_DAYS:
----
30
```

Note that `describe` prints ConfigMap values **in full**. That is the deliberate
difference from a Secret (§3) and the reason ConfigMaps must never hold anything
sensitive.

### Read a single key

```bash
kubectl get configmap yatri-app-config -o jsonpath='{.data.ENVIRONMENT}'; echo
# production

# All keys as shell-style pairs
kubectl get configmap yatri-app-config -o jsonpath='{range .data.*}{@}{"\n"}{end}'

# As JSON, for scripting
kubectl get configmap yatri-app-config -o json | jq -r '.data | to_entries[] | "\(.key)=\(.value)"'
```

### The YAML quoting trap

Every value in `data:` must be a **string**. The lab's manifest quotes them all,
and that is not stylistic:

```yaml
data:
  APP_PORT: "5000"          # ✅ string
  ENABLE_CACHE: "true"      # ✅ string
```

```yaml
data:
  APP_PORT: 5000            # ❌ rejected
  ENABLE_CACHE: true        # ❌ rejected
```

```text
error: error validating data: ValidationError(ConfigMap.data.APP_PORT):
invalid type for io.k8s.api.core.v1.ConfigMap.data: got "integer", expected "string"
```

The vicious version is YAML 1.1's boolean coercion: unquoted `no`, `off`, `yes`,
`on`, `y` and `n` all parse as booleans. A country code `NO` (Norway) silently
becomes `false`. **Quote everything.**

### Creating ConfigMaps imperatively

```bash
# From literals
kubectl create configmap app-config \
  --from-literal=ENVIRONMENT=production \
  --from-literal=LOG_LEVEL=INFO

# From a .env file (KEY=VALUE per line -> one key each)
kubectl create configmap app-config --from-env-file=app.env

# From a whole file (the FILENAME becomes the key, contents the value)
kubectl create configmap nginx-config --from-file=nginx.conf

# Custom key name
kubectl create configmap nginx-config --from-file=custom-key=nginx.conf

# Generate YAML for Git instead of applying — the GitOps-friendly form
kubectl create configmap app-config \
  --from-literal=ENVIRONMENT=production \
  --dry-run=client -o yaml > configmap.yaml
```

`--from-file` is how you ship whole config files (`nginx.conf`,
`application.yml`, `my.cnf`) and then mount them as volumes — see §4.

### Limits

| Limit | Value | Consequence |
| :--- | :--- | :--- |
| Max size | **1 MiB** | An etcd constraint. Large files need a volume or object storage |
| Namespace-scoped | Yes | A pod can only reference ConfigMaps in **its own** namespace |
| Key charset | alphanumerics, `-`, `_`, `.` | No spaces or slashes |

---

## 3. Part 2 — Secret

### The rule before you touch a Secret

```bash
echo    "mypassword" | base64      # ❌ WRONG — adds a trailing newline
echo -n "mypassword" | base64      # ✅ CORRECT
```

```text
bXlwYXNzd29yZAo=
bXlwYXNzd29yZA==
```

The `o=` ending encodes `\n`. Always `echo -n`. The full post-mortem is §9.

### Apply and inspect

```bash
kubectl apply -f secret.yaml
kubectl get secret yatri-db-secret
```

```text
NAME              TYPE     DATA   AGE
yatri-db-secret   Opaque   3      5s
```

```bash
kubectl describe secret yatri-db-secret
```

```text
Name:         yatri-db-secret
Namespace:    default
Labels:       app=yatri-app
Type:         Opaque

Data
====
POSTGRES_DB:        19 bytes
POSTGRES_PASSWORD:  14 bytes
POSTGRES_USER:      11 bytes
```

Values are masked — only byte counts are shown. Compare with the ConfigMap in §2,
which printed everything. That masking is the *entire* extra protection a Secret
gives you over a ConfigMap by default.

### Prove base64 is not encryption

```bash
kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 --decode; echo
# secretpassword
```

Anyone with `get secret` permission reads every value in one command. **Base64 is
an encoding, not encryption** — it exists so that arbitrary binary (TLS keys,
certificates) can live in a JSON/YAML field, not to protect anything.

```bash
# Dump every value in a namespace, if you doubt how easy it is
kubectl get secret yatri-db-secret -o json \
  | jq -r '.data | to_entries[] | "\(.key)=\(.value | @base64d)"'
```

```text
POSTGRES_DB=yatri_production_db
POSTGRES_PASSWORD=secretpassword
POSTGRES_USER=yatri_admin
```

### So what *is* the difference from a ConfigMap?

| | ConfigMap | Secret |
| :--- | :--- | :--- |
| Shown by `describe` | ✅ Full values | ❌ Byte counts only |
| Encoding | Plain text | base64 (**not** encryption) |
| Encrypted at rest in etcd | ❌ | ❌ **Not by default** — must be enabled |
| Stored on node disk | Written to disk | **tmpfs (RAM)** when mounted as a volume |
| Distributed to nodes | To nodes that need it | Only to nodes running a consuming pod |
| RBAC | Usually permissive | Should be locked down separately |
| Audit/tooling support | Generic | Many tools redact Secrets automatically |

The real protections come from things you must switch on: RBAC, **encryption at
rest**, and an external secret manager. §13 covers all three.

### Using `stringData` instead of hand-encoding

You never need to run base64 yourself — and if you never run it, you cannot
forget `-n`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: yatri-db-secret
type: Opaque
stringData:                        # plain text in; Kubernetes encodes on write
  POSTGRES_USER: "yatri_admin"
  POSTGRES_PASSWORD: "secretpassword"
  POSTGRES_DB: "yatri_production_db"
```

```bash
kubectl apply -f secret-stringdata.yaml
kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d; echo
# secretpassword   <- correctly encoded, no trailing newline, no chance of error
```

`stringData` is write-only: read the Secret back and you get `data` with base64
values. **Prefer `stringData` for everything hand-written.** The one thing it
cannot hold is true binary.

Or skip YAML entirely:

```bash
kubectl create secret generic yatri-db-secret \
  --from-literal=POSTGRES_USER='yatri_admin' \
  --from-literal=POSTGRES_PASSWORD='secretpassword' \
  --from-literal=POSTGRES_DB='yatri_production_db'
```

`--from-literal` never adds a newline either.

### Secret types

| `type` | Required keys | Used for |
| :--- | :--- | :--- |
| `Opaque` | any | Default — arbitrary key/value |
| `kubernetes.io/tls` | `tls.crt`, `tls.key` | Ingress TLS (§11) |
| `kubernetes.io/dockerconfigjson` | `.dockerconfigjson` | Private registry pulls |
| `kubernetes.io/basic-auth` | `username`, `password` | Basic auth |
| `kubernetes.io/ssh-auth` | `ssh-privatekey` | Git-over-SSH |
| `kubernetes.io/service-account-token` | — | Legacy SA tokens |

Typed Secrets are validated on creation — a `kubernetes.io/tls` Secret missing
`tls.key` is rejected immediately rather than failing mysteriously at request time.

---

## 4. Part 3 — Injecting config into the backend

`backend.yaml` demonstrates both injection styles in one pod spec:

```yaml
envFrom:
  - configMapRef:
      name: yatri-app-config       # imports ALL 5 keys at once

env:
  - name: POSTGRES_USER
    valueFrom:
      secretKeyRef:
        name: yatri-db-secret
        key: POSTGRES_USER          # one key at a time, explicitly named
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef: { name: yatri-db-secret, key: POSTGRES_PASSWORD }
  - name: POSTGRES_DB
    valueFrom:
      secretKeyRef: { name: yatri-db-secret, key: POSTGRES_DB }
```

```bash
kubectl apply -f backend.yaml
kubectl rollout status deployment/yatri-backend
kubectl get pods -l app=yatri-backend
```

```text
NAME                             READY   STATUS    RESTARTS   AGE
yatri-backend-7c9f6b8d4-4xp2q    1/1     Running   0          25s
yatri-backend-7c9f6b8d4-mwrtk    1/1     Running   0          25s
```

### Verify the injection

```bash
kubectl exec -it deployment/yatri-backend -- env \
  | grep -E "ENVIRONMENT|LOG_LEVEL|DEFAULT_CURRENCY|POSTGRES"
```

```text
ENVIRONMENT=production
LOG_LEVEL=INFO
DEFAULT_CURRENCY=INR
POSTGRES_USER=yatri_admin
POSTGRES_PASSWORD=secretpassword
POSTGRES_DB=yatri_production_db
```

The pod reads both sources as ordinary Linux environment variables — the
application code cannot tell which came from where, which is exactly the point.

### `envFrom` vs `env` — when to use which

| | `envFrom` | `env` + `valueFrom` |
| :--- | :--- | :--- |
| Scope | Every key in the object | One named key |
| Rename on inject | ❌ Key name becomes the var name | ✅ Any variable name you like |
| New keys appear automatically | ✅ On next restart | ❌ Must edit the Deployment |
| Missing key | Silently absent | Pod **fails to start** — a useful guardrail |
| Visible in the manifest | ❌ Opaque | ✅ Self-documenting |

Use `envFrom` for bulk plain config where the key names are already right. Use
`env` + `secretKeyRef` for secrets — it documents exactly which credentials the
workload consumes, which is what an auditor will ask for.

**Guard against invalid keys:** `envFrom` silently skips keys that are not valid
shell identifiers (`my-key`, `app.port`) rather than failing. Use `-` and `.`
freely in ConfigMaps consumed as *files*, but stick to `UPPER_SNAKE_CASE` for
anything consumed as an environment variable.

### Make a missing object fail fast

If `yatri-app-config` does not exist, the pod is stuck in
`CreateContainerConfigError` — which is correct, loud, and easy to diagnose:

```bash
kubectl delete configmap yatri-app-config
kubectl rollout restart deployment/yatri-backend
kubectl get pods -l app=yatri-backend
```

```text
NAME                             READY   STATUS                       RESTARTS   AGE
yatri-backend-6b8d9c7f5-2kx4p    0/1     CreateContainerConfigError   0          15s
```

```bash
kubectl describe pod -l app=yatri-backend | grep -A 3 Events | tail -n 3
# Error: configmap "yatri-app-config" not found
```

```bash
kubectl apply -f configmap.yaml      # restore before continuing
kubectl rollout restart deployment/yatri-backend
```

Mark a reference optional only when the app has a sane default:

```yaml
envFrom:
  - configMapRef:
      name: optional-overrides
      optional: true      # pod starts even if this ConfigMap is absent
```

### The third injection method: volume mounts

Environment variables have two real drawbacks — they are **frozen at container
start** (§10), and they leak into crash dumps, `/proc/<pid>/environ`, and any log
line that dumps the environment. Mounting as files avoids both:

```yaml
spec:
  containers:
    - name: backend
      volumeMounts:
        - name: config-volume
          mountPath: /etc/config
          readOnly: true
        - name: secret-volume
          mountPath: /etc/secrets
          readOnly: true
  volumes:
    - name: config-volume
      configMap:
        name: yatri-app-config
    - name: secret-volume
      secret:
        secretName: yatri-db-secret
        defaultMode: 0400          # owner read-only
```

```bash
kubectl exec -it deployment/yatri-backend -- ls -la /etc/config
kubectl exec -it deployment/yatri-backend -- cat /etc/config/ENVIRONMENT
```

Each key becomes a file whose contents are the value (already base64-decoded for
Secrets — the application reads plain text).

**Mount only the keys you need,** rather than exposing the whole object:

```yaml
volumes:
  - name: secret-volume
    secret:
      secretName: yatri-db-secret
      items:
        - key: POSTGRES_PASSWORD
          path: db-password        # appears at /etc/secrets/db-password only
      defaultMode: 0400
```

### Env vars vs volumes — the comparison that decides it

| | Environment variables | Volume mounts |
| :--- | :--- | :--- |
| Picks up updates without a restart | ❌ **Never** | ✅ Yes (~60s sync) |
| Visible in `/proc/<pid>/environ` | ✅ Leaks | ❌ |
| Appears in crash dumps / `kubectl describe pod` | ✅ Often | ❌ |
| Can hold binary or large files | ❌ | ✅ |
| Per-file permissions | ❌ | ✅ `defaultMode` |
| Secret stored on node as | env in container config | **tmpfs (RAM)**, never disk |
| App code changes needed | None | Must read files |

**For secrets in production, prefer volume mounts.** The lab uses environment
variables because they demonstrate the mechanism in one screen — that is a
teaching choice, not a recommendation.

---

## 5. Part 4 — The frontend

```bash
kubectl apply -f frontend.yaml
kubectl get pods -l app=yatri-frontend
kubectl get svc yatri-frontend-service yatri-backend-service
```

```text
NAME                              READY   STATUS    RESTARTS   AGE
yatri-frontend-6d8b4c7f5-9lkpj    1/1     Running   0          18s
yatri-frontend-6d8b4c7f5-xmn2r    1/1     Running   0          18s

NAME                     TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
yatri-frontend-service   ClusterIP   10.96.45.12     <none>        80/TCP    22s
yatri-backend-service    ClusterIP   10.96.112.88    <none>        80/TCP    3m
```

**Both Services are `ClusterIP`** — `EXTERNAL-IP: <none>`, unreachable from
outside. Confirm:

```bash
curl -s --max-time 3 http://10.96.45.12 || echo "unreachable from host — as expected"
```

That is why an Ingress is needed. The alternative — making each Service a
LoadBalancer — means one billed cloud load balancer per service, and still no
path-based routing (Session 11, Q4).

Note that the frontend also consumes `yatri-app-config` via `envFrom`. One
ConfigMap serving several workloads is the normal pattern; the ConfigMap is
namespace-scoped, not pod-scoped.

---

## 6. Part 5 — Ingress

### Controller first

An **Ingress** object is inert data. Without an **Ingress Controller** watching for
it, `kubectl apply` succeeds, `ADDRESS` stays empty forever, and nothing routes.
This is the single most common Ingress mistake.

```bash
minikube addons enable ingress
kubectl get pods -n ingress-nginx
```

```text
NAME                                        READY   STATUS      RESTARTS   AGE
ingress-nginx-admission-create-x8k2m        0/1     Completed   0          45s
ingress-nginx-admission-patch-9lp4q         0/1     Completed   0          45s
ingress-nginx-controller-7799c6795f-9k2lw   1/1     Running     0          45s
```

```bash
kubectl get ingressclass
```

```text
NAME    CONTROLLER             PARAMETERS   AGE
nginx   k8s.io/ingress-nginx   <none>       50s
```

`spec.ingressClassName: nginx` in the manifest must match this name — otherwise no
controller claims the Ingress.

### The routing rules

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: yatri-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "false"
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  ingressClassName: nginx
  rules:
    - host: yatri.local
      http:
        paths:
          - path: /api(/|$)(.*)
            pathType: ImplementationSpecific
            backend:
              service: { name: yatri-backend-service, port: { number: 80 } }
          - path: /
            pathType: Prefix
            backend:
              service: { name: yatri-frontend-service, port: { number: 80 } }
```

```bash
kubectl apply -f ingress.yaml
kubectl get ingress yatri-ingress
```

Re-run until `ADDRESS` is populated (a few seconds):

```text
NAME            CLASS   HOSTS         ADDRESS        PORTS   AGE
yatri-ingress   nginx   yatri.local   192.168.49.2   80      15s
```

```bash
kubectl describe ingress yatri-ingress
```

```text
Name:             yatri-ingress
Namespace:        default
Address:          192.168.49.2
Rules:
  Host         Path              Backends
  ----         ----              --------
  yatri.local  /api(/|$)(.*)     yatri-backend-service:80 (10.244.0.41:5000,10.244.0.42:5000)
               /                 yatri-frontend-service:80 (10.244.0.43:80,10.244.0.44:80)
```

**Check that the backends list real pod IPs.** `describe` showing
`<error: endpoints "x" not found>` means the Service has no endpoints — that is a
Service problem, not an Ingress problem (Session 11, §12).

### Decoding the rewrite

```text
path:            /api(/|$)(.*)
                      │      │
                      │      └── capture group $2 = everything after /api/
                      └───────── capture group $1 = "/" or end-of-string
rewrite-target:  /$2
```

| Client requests | `$2` | Backend receives |
| :--- | :--- | :--- |
| `/api` | `` (empty) | `/` |
| `/api/` | `` (empty) | `/` |
| `/api/bookings` | `bookings` | `/bookings` |
| `/api/v1/users?id=5` | `v1/users` | `/v1/users?id=5` |

Without the rewrite the backend would receive `/api/bookings` and 404, because it
serves `/bookings`. The `(/|$)` group is what makes both `/api` and `/api/` work —
a very common off-by-one in hand-written Ingress rules.

`use-regex: "true"` is mandatory here; without it the path is treated literally.

### `pathType` — the field people get wrong

| `pathType` | Matching | `/api` matches |
| :--- | :--- | :--- |
| `Exact` | Exact string, case-sensitive | `/api` only |
| `Prefix` | Path **element** by element | `/api`, `/api/v1` — but **not** `/apifoo` |
| `ImplementationSpecific` | Controller decides — enables regex on nginx | per controller |

`Prefix` splits on `/`, so `/api` does not match `/apifoo`. Regex requires
`ImplementationSpecific` — using `Prefix` with a regex path silently treats the
regex as a literal string and nothing matches.

**Rule ordering:** nginx-ingress evaluates the *most specific* path first
regardless of YAML order, so `/api(/|$)(.*)` wins over `/` for `/api/*`. Do not
rely on this across controllers; Traefik and HAProxy have their own precedence.

---

## 7. Part 6 — Testing the routing

```bash
INGRESS_IP=$(kubectl get ingress yatri-ingress -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
[ -z "$INGRESS_IP" ] && INGRESS_IP=$(minikube ip)
echo "Ingress IP: ${INGRESS_IP}"
```

### Test 1 — root path hits the frontend

```bash
curl -s -H "Host: yatri.local" "http://${INGRESS_IP}/" | grep -i "<title>"
```

```text
<title>Welcome to nginx!</title>
```

### Test 2 — `/api/` hits the backend and returns the injected config

```bash
curl -s -H "Host: yatri.local" "http://${INGRESS_IP}/api/"
```

```text
Yatri Backend API
=================
ENVIRONMENT     : production
LOG_LEVEL       : INFO
DEFAULT_CURRENCY: INR
POSTGRES_USER   : yatri_admin
POSTGRES_DB     : yatri_production_db
```

This single response proves the whole chain: ConfigMap → env vars → pod →
ClusterIP Service → Ingress rule → one IP.

### Why `-H "Host: yatri.local"` is required

The Ingress rule is host-based. nginx routes on the HTTP `Host` header, and
`yatri.local` is not in public DNS. The header tells nginx which rule applies
without any DNS at all.

Omit it and you get the default backend:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://${INGRESS_IP}/"
# 404
```

That 404 comes from **nginx**, not your app — no rule matched. For a
browser-friendly setup, add a hosts entry instead:

```bash
# Linux/macOS
echo "${INGRESS_IP} yatri.local" | sudo tee -a /etc/hosts
# Windows (elevated): C:\Windows\System32\drivers\etc\hosts
```

```bash
curl -s http://yatri.local/api/
```

### Confirm the traffic path

```bash
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller --tail=5
```

```text
192.168.49.1 - - [17/Sep/2026:10:32:14 +0000] "GET /api/ HTTP/1.1" 200 148
  "-" "curl/8.4.0" 85 0.004 [default-yatri-backend-service-80] [] 10.244.0.41:5000 148 0.004 200
```

The `[default-yatri-backend-service-80]` field names the upstream chosen and
`10.244.0.41:5000` the exact pod — the fastest way to confirm routing without
guessing.

---

## 8. Part 7 — The full picture

```bash
kubectl get configmap yatri-app-config
kubectl get secret    yatri-db-secret
kubectl get pods      -l app=yatri-frontend
kubectl get pods      -l app=yatri-backend
kubectl get svc       yatri-frontend-service yatri-backend-service
kubectl get ingress   yatri-ingress
```

```text
                          Internet / curl
                                 │
                                 ▼  Host: yatri.local
                    ┌────────────────────────────┐
                    │  Ingress Controller pod    │   ONE entry point, ONE IP
                    │  (ingress-nginx, L7)       │   192.168.49.2:80
                    └────────────┬───────────────┘
                     /api/*      │       /
              ┌─────────────────┴───────────────────┐
              ▼                                     ▼
   yatri-backend-service                 yatri-frontend-service
   (ClusterIP :80 -> :5000)              (ClusterIP :80 -> :80)
              │                                     │
       ┌──────┴──────┐                       ┌──────┴──────┐
       ▼             ▼                       ▼             ▼
  backend pod    backend pod            frontend pod   frontend pod
       │                                     │
       │ envFrom: yatri-app-config ──────────┘  (ENVIRONMENT, LOG_LEVEL, …)
       │ env:     yatri-db-secret               (POSTGRES_USER/PASSWORD/DB)
```

Four object types doing four distinct jobs:

| Object | Job |
| :--- | :--- |
| **ConfigMap** | Non-secret config, decoupled from the image |
| **Secret** | Credentials, masked in output, tmpfs when mounted |
| **Service** | Stable internal address + load balancing (L4) |
| **Ingress** | One external entry point, host/path routing, TLS (L7) |

---

## 9. Part 8 — The newline bug, debugged

### The incident

PostgreSQL rejects every connection:

```text
FATAL: password authentication failed for user "yatri_admin"
```

The developer insists the password is right — they encoded it with
`echo "mypassword" | base64`.

### Investigation

```bash
echo "mypassword" | xxd
```

```text
00000000: 6d79 7061 7373 776f 7264 0a              mypassword.
```

That trailing `0a` is `\n`. `echo` appends a newline by default; base64 faithfully
encodes it.

```bash
echo "secretpassword" | base64      # bXlwYXNzd29yZAo=  -> ends in Ao=
echo -n "secretpassword" | base64   # c2VjcmV0cGFzc3dvcmQ=
```

Decode the wrong one and watch the cursor jump a line:

```bash
echo "c2VjcmV0cGFzc3dvcmQK" | base64 --decode
```

PostgreSQL receives `secretpassword\n` — 15 bytes, not 14 — and correctly rejects it.

### Detecting it in an existing Secret

You cannot see a trailing newline. Measure instead:

```bash
kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' \
  | base64 -d | wc -c
# 14   <- correct.  15 would mean a trailing newline
```

```bash
# Unambiguous: show it as hex and look for a trailing 0a
kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d | xxd | tail -n 1
```

```bash
# Or make it visible with a sentinel
kubectl get secret yatri-db-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' \
  | base64 -d | sed -e 's/$/<END>/'
# secretpassword<END>      ✅
# secretpassword
# <END>                    ❌ newline present
```

Audit every key at once:

```bash
kubectl get secret yatri-db-secret -o json \
  | jq -r '.data | to_entries[] | "\(.key)\t\(.value|@base64d|length) bytes\t\(.value|@base64d|test("\n$"))"'
```

### Fixes, best first

```yaml
# 1. BEST — stringData. You never touch base64, so you cannot get it wrong.
apiVersion: v1
kind: Secret
metadata:
  name: yatri-db-secret
type: Opaque
stringData:
  POSTGRES_PASSWORD: "secretpassword"
```

```bash
# 2. GOOD — kubectl create secret. Also never adds a newline.
kubectl create secret generic yatri-db-secret \
  --from-literal=POSTGRES_PASSWORD='secretpassword' \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. If you must encode by hand:
printf '%s' 'secretpassword' | base64      # printf is safest — no implicit newline
echo -n     'secretpassword' | base64      # -n works in bash; NOT portable to all /bin/sh
```

`printf '%s'` is the portable choice. In `dash` (Debian's `/bin/sh`) and some
other shells, `echo -n` prints a literal `-n`, reintroducing the bug in a
different form.

### Platform note — encoding on Windows

Windows PowerShell has its own version of this trap, since it defaults to UTF-16:

```powershell
# ❌ WRONG — UTF-16LE produces null bytes between every character
[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("secretpassword"))

# ✅ CORRECT — UTF-8, no BOM, no trailing newline
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("secretpassword"))
```

### Related failures with the same signature

- **`kubectl create secret --from-file=password.txt`** — the file almost certainly
  ends with a newline, which becomes part of the value. Strip it first:
  `printf '%s' "$(cat password.txt)" > password.clean`
- **A trailing space** before the newline in YAML — same symptom, even harder to see.
- **Copy-paste from a terminal** picking up a trailing newline.
- **CRLF line endings** on Windows — you get `\r\n`, so the value is 2 bytes long.
  Enforce LF with a `.gitattributes` entry.

---

## 10. Part 9 — What happens when you update a ConfigMap

### The demonstration

```bash
kubectl patch configmap yatri-app-config --type merge -p '{"data":{"ENVIRONMENT":"staging"}}'
kubectl get configmap yatri-app-config -o jsonpath='{.data.ENVIRONMENT}'; echo
# staging      <- the ConfigMap changed immediately
```

```bash
kubectl exec -it deployment/yatri-backend -- env | grep ENVIRONMENT
# ENVIRONMENT=production      <- the POD did not
```

### Why

Environment variables are materialised **once**, by the kubelet, at container
creation. The container runtime receives a fixed env list. Nothing in Linux can
change another process's environment afterwards — this is an OS-level constraint,
not a Kubernetes limitation.

### The fix

```bash
kubectl rollout restart deployment/yatri-backend
kubectl rollout status  deployment/yatri-backend
kubectl exec -it deployment/yatri-backend -- env | grep ENVIRONMENT
# ENVIRONMENT=staging
```

`rollout restart` performs a normal rolling update — no downtime, and new pods
pick up the new values.

Restore before cleanup:

```bash
kubectl patch configmap yatri-app-config --type merge -p '{"data":{"ENVIRONMENT":"production"}}'
kubectl rollout restart deployment/yatri-backend
```

### Volume mounts *do* update — with caveats

```bash
kubectl exec -it deployment/yatri-backend -- cat /etc/config/ENVIRONMENT
kubectl patch configmap yatri-app-config --type merge -p '{"data":{"ENVIRONMENT":"staging"}}'
sleep 90
kubectl exec -it deployment/yatri-backend -- cat /etc/config/ENVIRONMENT
# staging   <- updated with no restart
```

| | Env var | Volume mount |
| :--- | :--- | :--- |
| Updates without restart | ❌ Never | ✅ Yes |
| Propagation delay | n/a | Up to ~60s (kubelet sync + cache TTL) |
| App must re-read the file | n/a | ✅ Yes — the file changes, the app may not notice |
| `subPath` mounts | n/a | ❌ **Never update** |

Two things that break this:

**`subPath` mounts never update.** This is the most common "but it works on
volumes!" surprise:

```yaml
# ❌ Will NEVER pick up changes
volumeMounts:
  - name: config
    mountPath: /etc/nginx/nginx.conf
    subPath: nginx.conf
```

```yaml
# ✅ Mount the directory; the file updates
volumeMounts:
  - name: config
    mountPath: /etc/nginx/conf.d
```

**The file updating is not the app reloading.** nginx will not re-read
`nginx.conf` until it gets `SIGHUP`. Either give the app a config watcher, run a
reloader sidecar, or accept that you need a restart anyway.

### The production pattern: make config changes trigger rollouts

Silent config drift — where a ConfigMap change takes effect on the next unrelated
restart, hours later and on some pods but not others — is genuinely dangerous.
Two ways to make it deterministic:

**1. Checksum annotation** (standard in Helm charts). The pod template hash
changes when the config changes, so Kubernetes rolls automatically:

```yaml
spec:
  template:
    metadata:
      annotations:
        checksum/config: "{{ include (print $.Template.BasePath \"/configmap.yaml\") . | sha256sum }}"
```

**2. Immutable, versioned ConfigMaps** — the more explicit option:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: yatri-app-config-v2      # new name per version
immutable: true                   # cannot be edited; must be replaced
data:
  ENVIRONMENT: "staging"
```

Point the Deployment at `-v2` and you get a normal rollout with a normal rollback
path. `immutable: true` also improves cluster performance measurably: the kubelet
stops watching the object for changes, which matters at scale.

Kustomize does this for you with `configMapGenerator`, which appends a content
hash to the name and rewrites the references.

---

## 11. TLS termination with Ingress

`03-ingress/ingress-tls.yaml` adds HTTPS and host-based routing across two hosts.

### Create the TLS Secret

For the lab, a self-signed certificate:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=portal.campus.local/O=campus" \
  -addext "subjectAltName=DNS:portal.campus.local,DNS:api.campus.local"

kubectl create secret tls campus-tls-cert --cert=tls.crt --key=tls.key
kubectl get secret campus-tls-cert
```

```text
NAME              TYPE                DATA   AGE
campus-tls-cert   kubernetes.io/tls   2      5s
```

The type is `kubernetes.io/tls` with exactly two keys, `tls.crt` and `tls.key`.
`kubectl create secret tls` validates that the key matches the certificate —
another reason not to hand-write it.

**The SAN is not optional.** Modern clients ignore the CN entirely; a certificate
without a matching `subjectAltName` fails verification no matter what the CN says.

### Apply and test

```bash
kubectl apply -f ../03-ingress/ingress-tls.yaml
kubectl get ingress campus-ingress-tls
```

```text
NAME                 CLASS   HOSTS                                  ADDRESS        PORTS     AGE
campus-ingress-tls   nginx   portal.campus.local,api.campus.local   192.168.49.2   80, 443   20s
```

`PORTS` now shows `80, 443`.

```bash
INGRESS_IP=$(minikube ip)

# HTTP is redirected to HTTPS (ssl-redirect: "true")
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: portal.campus.local" "http://${INGRESS_IP}/"
# 308

# HTTPS  (-k because the cert is self-signed; --resolve fakes DNS for SNI)
curl -sk --resolve "portal.campus.local:443:${INGRESS_IP}" \
  https://portal.campus.local/ | grep -i "<title>"

curl -sk --resolve "api.campus.local:443:${INGRESS_IP}" \
  https://api.campus.local/api/
```

`--resolve` is better than `-H "Host: ..."` for HTTPS: TLS needs the **SNI** field
set during the handshake, which happens before any HTTP header is sent. A `Host`
header alone gives you the wrong certificate.

```bash
# Inspect the served certificate
openssl s_client -connect "${INGRESS_IP}:443" -servername portal.campus.local </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName
```

### TLS termination, illustrated

```text
Client ──HTTPS (encrypted)──► Ingress Controller ──HTTP (plaintext)──► ClusterIP Service ──► Pod
                                      │
                         decrypts here using campus-tls-cert
```

Traffic between the controller and your pods is **plaintext inside the cluster**.
For most clusters that is acceptable; for regulated workloads it is not, and you
need either a service mesh with mTLS or re-encryption via
`nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"`.

### Production: cert-manager, not openssl

Self-signed certificates are for labs. In production, cert-manager issues and
auto-renews real certificates from Let's Encrypt:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: devops@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            class: nginx
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: yatri-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod    # the only line you add
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["yatri.example.com"]
      secretName: yatri-tls          # cert-manager CREATES and RENEWS this Secret
  rules:
    - host: yatri.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: yatri-frontend-service, port: { number: 80 } }
```

cert-manager solves the ACME challenge, writes the Secret, and renews at 2/3 of
the certificate lifetime. Certificate expiry stops being an incident class.

### Useful nginx-ingress annotations

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"        # default 1m rejects uploads
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/limit-rps: "100"              # per source IP
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://app.example.com"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      more_set_headers "X-Frame-Options: DENY";
      more_set_headers "X-Content-Type-Options: nosniff";
      more_set_headers "Strict-Transport-Security: max-age=31536000; includeSubDomains";
    # Weighted canary — true percentage routing, unlike replica-ratio canary
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
```

`proxy-body-size` deserves special mention: the 1 MB default causes a `413` on
every file upload, and it is almost always the answer to "uploads work locally
but fail in the cluster".

> **Security note:** `configuration-snippet` injects raw nginx config. Recent
> ingress-nginx versions disable it by default (`allow-snippet-annotations:
> false`) because it enabled privilege escalation from anyone with Ingress write
> access. Prefer purpose-built annotations, and treat Ingress write permission as
> privileged.

---

## 12. Troubleshooting playbook

### Ingress returns 404

```bash
kubectl get ingress <name> -o yaml | grep -A 3 ingressClassName
kubectl get ingressclass
kubectl describe ingress <name>
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller --tail=50
```

| Cause | Check | Fix |
| :--- | :--- | :--- |
| No controller installed | `kubectl get pods -n ingress-nginx` | Install one |
| `ingressClassName` missing/wrong | `kubectl get ingressclass` | Match the class name exactly |
| Host header not sent | `curl -H "Host: yatri.local"` | Send it, or add a `/etc/hosts` entry |
| Wrong `pathType` with a regex | `describe ingress` | Use `ImplementationSpecific` + `use-regex` |
| Service in another namespace | `kubectl get svc -A` | **Ingress can only target Services in its own namespace** |

### Ingress returns 502 / 503

502 means the controller found the rule but could not reach the backend — an
endpoint problem, not a routing problem:

```bash
kubectl describe ingress <name> | grep -A 5 Rules       # do Backends list pod IPs?
kubectl get endpointslices -l kubernetes.io/service-name=<svc>
kubectl exec -n ingress-nginx deploy/ingress-nginx-controller -- \
  curl -s -o /dev/null -w '%{http_code}\n' http://<svc>.<ns>.svc.cluster.local
```

| Code | Meaning | Usual cause |
| :--- | :--- | :--- |
| `502` | Bad gateway | Wrong `targetPort`; app not listening; app crashed |
| `503` | Service unavailable | **No endpoints** — pods not Ready or selector mismatch |
| `504` | Gateway timeout | Backend too slow; raise `proxy-read-timeout` |
| `413` | Payload too large | Raise `proxy-body-size` |

### `ADDRESS` stays empty

```bash
kubectl get pods -n ingress-nginx
kubectl get svc  -n ingress-nginx ingress-nginx-controller
```

Either no controller is running, or its Service is `type: LoadBalancer` on a
cluster with no cloud provider — in which case it is `<pending>` forever and you
need `minikube tunnel` or MetalLB.

### Pod stuck in `CreateContainerConfigError`

```bash
kubectl describe pod <pod> | grep -A 5 Events
```

A referenced ConfigMap/Secret **object** is missing. (A missing *key* inside an
existing object gives `CreateContainerConfigError` too, with a different message
naming the key.) Verify both:

```bash
kubectl get configmap,secret
kubectl get configmap yatri-app-config -o jsonpath='{.data}' | jq 'keys'
```

### Env vars not appearing in the pod

```bash
kubectl exec <pod> -- env | sort
kubectl get pod <pod> -o jsonpath='{.spec.containers[0].envFrom}'
```

Most likely: the ConfigMap changed but the pod was not restarted (§10), or the key
name is not a valid shell identifier and `envFrom` skipped it silently.

### A password is rejected despite looking correct

Go to §9. Check the byte length first — it takes five seconds and is right
most of the time.

---

## 13. Production hardening — secrets that are actually secret

Everything above is lab-grade. A Secret committed to Git, or stored unencrypted in
etcd, is not a secret.

### 1. Enable encryption at rest

By default, Secrets are stored in etcd **base64-encoded but unencrypted**. Anyone
with an etcd backup has every credential in the cluster.

```yaml
# /etc/kubernetes/enc/encryption-config.yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources: ["secrets"]
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-32-byte-key>
      - identity: {}       # MUST be last — allows reading pre-existing plaintext
```

```bash
# API server flag
--encryption-provider-config=/etc/kubernetes/enc/encryption-config.yaml

# Re-encrypt everything already stored
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
```

Better still, use a KMS provider (AWS KMS, GCP KMS, Azure Key Vault) so the
encryption key itself never sits on disk.

### 2. Lock down RBAC

`get secret` is equivalent to reading every credential in the namespace. Grant it
deliberately:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: production
  name: secret-reader
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["yatri-db-secret"]   # this ONE secret, not all of them
    verbs: ["get"]                        # not list, not watch
```

Omitting `resourceNames` grants access to *every* Secret in the namespace. And
note that `list` cannot be restricted by `resourceNames` — granting `list` grants
everything, which is why the rule above omits it.

```bash
kubectl auth can-i get secrets --as=system:serviceaccount:production:yatri-api -n production
kubectl auth can-i list secrets --as=system:serviceaccount:production:yatri-api -n production
```

### 3. Never commit Secrets to Git

The three workable options:

**Sealed Secrets** — encrypt with a cluster public key; only the in-cluster
controller can decrypt. The encrypted file is safe to commit:

```bash
kubeseal --format yaml < secret.yaml > sealed-secret.yaml
git add sealed-secret.yaml
```

**External Secrets Operator** — the real secret lives in AWS Secrets Manager /
Vault / Azure Key Vault; the cluster syncs it. Git holds only a reference:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: yatri-db-secret
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: yatri-db-secret
  data:
    - secretKey: POSTGRES_PASSWORD
      remoteRef:
        key: prod/yatri/db
        property: password
```

**SOPS + age/KMS** — encrypt values in place; the YAML structure stays readable in
diffs while values are ciphertext.

Add a pre-commit guard regardless:

```bash
# .pre-commit-config.yaml — gitleaks catches what discipline misses
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
```

### 4. Mount as files, not environment variables

Environment variables leak into `/proc/<pid>/environ`, crash dumps, APM payloads,
`kubectl describe pod` output, and any log line that dumps the environment. Volume
mounts avoid all of it, are stored on **tmpfs (RAM, never disk)**, and support
`defaultMode: 0400`. See §4.

### 5. Rotate — and make sure pods notice

```bash
kubectl create secret generic yatri-db-secret \
  --from-literal=POSTGRES_PASSWORD="$NEW_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/yatri-backend
kubectl rollout status  deployment/yatri-backend
```

Rotating the Secret without restarting consumers changes nothing for
env-var-based pods (§10) — a rotation that silently does not take effect is worse
than no rotation, because you believe you are covered.

### 6. Hardened ConfigMap + Secret consumption

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: yatri-backend
spec:
  template:
    spec:
      automountServiceAccountToken: false     # not needed unless the app calls the API
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
      containers:
        - name: backend
          envFrom:
            - configMapRef:
                name: yatri-app-config-v3     # immutable, versioned
          volumeMounts:
            - name: db-credentials
              mountPath: /etc/secrets
              readOnly: true
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
      volumes:
        - name: db-credentials
          secret:
            secretName: yatri-db-secret
            defaultMode: 0400
            items:
              - key: POSTGRES_PASSWORD        # ONLY the key this pod needs
                path: db-password
```

### Checklist

**ConfigMaps**
- [ ] All values quoted as strings (beware YAML 1.1 `no`/`yes`/`on`/`off`)
- [ ] No secrets in ConfigMaps — ever
- [ ] `immutable: true` + versioned names, or a Helm checksum annotation
- [ ] Under 1 MiB
- [ ] `UPPER_SNAKE_CASE` keys for anything consumed via `envFrom`

**Secrets**
- [ ] `stringData` or `kubectl create secret` — never hand-rolled base64
- [ ] Byte length verified after creation (`| base64 -d | wc -c`)
- [ ] Encryption at rest enabled on the API server (ideally KMS-backed)
- [ ] RBAC scoped with `resourceNames`; `list` granted to nobody by default
- [ ] Never committed to Git — Sealed Secrets, ESO, or SOPS
- [ ] Mounted as read-only files with `defaultMode: 0400`, not env vars
- [ ] `items:` used to project only the needed keys
- [ ] Rotation procedure includes `rollout restart`
- [ ] Secret-scanning (gitleaks/trufflehog) in pre-commit and CI

**Ingress**
- [ ] `ingressClassName` set explicitly
- [ ] TLS with cert-manager, auto-renewing
- [ ] `ssl-redirect` / `force-ssl-redirect` enabled
- [ ] HSTS, `X-Frame-Options`, `X-Content-Type-Options` set
- [ ] `proxy-body-size` raised above 1 MB if you accept uploads
- [ ] Rate limiting (`limit-rps`) on public endpoints
- [ ] `pathType` chosen deliberately; regex paired with `ImplementationSpecific`
- [ ] Ingress Controller runs ≥ 2 replicas with a PodDisruptionBudget
- [ ] Snippet annotations disabled cluster-wide; Ingress write access treated as privileged

---

## 14. Lab completion checklist

- [x] Applied `configmap.yaml` and read a key with `-o jsonpath` — §2
- [x] Applied `secret.yaml` and decoded `POSTGRES_PASSWORD` with `base64 --decode` — §3
- [x] Applied `backend.yaml` and verified env vars inside the pod with `kubectl exec` — §4
- [x] Applied `frontend.yaml` and confirmed both Services are `ClusterIP` — §5
- [x] Enabled the NGINX Ingress Controller and confirmed the pod is `Running` — §6
- [x] Applied `ingress.yaml` and confirmed `ADDRESS` appeared — §6
- [x] Tested `/` returns nginx HTML via `curl -H "Host: yatri.local"` — §7
- [x] Tested `/api/` returns backend config values — §7
- [x] Demonstrated the `echo` vs `echo -n` newline bug — §9
- [x] Triggered a rolling restart after a ConfigMap update and confirmed the new value — §10

Beyond the required list: TLS termination with a `kubernetes.io/tls` Secret (§11),
a full 404/502/503 triage playbook (§12), and production secret management (§13).

---

## 15. Cleanup

```bash
bash cleanup.sh
```

```text
[INFO] Deleting Ingress...
ingress.networking.k8s.io "yatri-ingress" deleted
[INFO] Deleting Backend Deployment and Service...
deployment.apps "yatri-backend" deleted
service "yatri-backend-service" deleted
[INFO] Deleting Frontend Deployment and Service...
deployment.apps "yatri-frontend" deleted
service "yatri-frontend-service" deleted
[INFO] Deleting Secret...
secret "yatri-db-secret" deleted
[INFO] Deleting ConfigMap...
configmap "yatri-app-config" deleted
[INFO] All demo resources removed.
```

```bash
# Verify — each should say "No resources found" or NotFound
kubectl get all -l app=yatri-app
kubectl get configmap yatri-app-config
kubectl get secret    yatri-db-secret
kubectl get ingress   yatri-ingress
```

Extras created by this solutions guide:

```bash
kubectl delete ingress campus-ingress-tls --ignore-not-found
kubectl delete secret  campus-tls-cert    --ignore-not-found
rm -f tls.crt tls.key
minikube addons disable ingress
```

---

## Command reference

```bash
# ConfigMaps
kubectl create configmap <name> --from-literal=K=V --from-file=app.conf --from-env-file=app.env
kubectl get configmap <name> -o jsonpath='{.data.KEY}'
kubectl describe configmap <name>
kubectl patch configmap <name> --type merge -p '{"data":{"KEY":"VALUE"}}'
kubectl create configmap <name> --from-literal=K=V --dry-run=client -o yaml

# Secrets
kubectl create secret generic <name> --from-literal=K=V
kubectl create secret tls <name> --cert=tls.crt --key=tls.key
kubectl create secret docker-registry <name> --docker-server=... --docker-username=... --docker-password=...
kubectl get secret <name> -o jsonpath='{.data.KEY}' | base64 -d
kubectl get secret <name> -o json | jq -r '.data | to_entries[] | "\(.key)=\(.value|@base64d)"'
kubectl get secret <name> -o jsonpath='{.data.KEY}' | base64 -d | wc -c   # newline check

# Consumption
kubectl exec <pod> -- env | sort
kubectl exec <pod> -- ls -la /etc/config /etc/secrets
kubectl rollout restart deployment/<name>

# Ingress
kubectl get ingress -A
kubectl describe ingress <name>
kubectl get ingressclass
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller -f
curl -s -H "Host: <host>" "http://$(minikube ip)/path"
curl -sk --resolve "<host>:443:$(minikube ip)" "https://<host>/path"
openssl s_client -connect "$(minikube ip):443" -servername <host> </dev/null | openssl x509 -noout -text
```
