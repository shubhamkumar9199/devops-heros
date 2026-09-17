# Session 10 - Pod Lifecycle and Deployment Strategies - Task (part 2)

- **Name:** Shubham Kumar
- **Enrollment No:** 24BCS10320

---

> **Scope:** this is a **second** write-up for session 10. My first one,
> [`README.md`](README.md), covers the core objects in
> [`../k8s-core-objects/`](../k8s-core-objects/) — Pod, ReplicaSet, Deployment,
> DaemonSet, StatefulSet — with screenshots from a live minikube run. It does not
> touch the session's other lab folders, so this file covers those:
> [`../pod-lifecycle/`](../pod-lifecycle/), the four deployment strategies in
> [`../01-rolling-update/`](../01-rolling-update/) through
> [`../04-recreate/`](../04-recreate/), and the two broken manifests in
> [`../troubleshooting/`](../troubleshooting/).

> **Note on verification:** unlike [`README.md`](README.md), the terminal output
> below is **expected output derived from the manifests, not captured from a live
> run**. I will replace these blocks with real captures and screenshots once I run
> the labs. The manifests, resource names, labels and NodePorts are read directly
> from the files in this session folder.

---

## What the task asked

[`../Readme.md`](../Readme.md) links to a reference rather than stating a task —
the same situation I described in [`README.md`](README.md). The session ships
three further sets of manifests with no accompanying questions except in
[`../pod-lifecycle/README.md`](../pod-lifecycle/README.md), which ends by asking
six questions of every scenario:

1. What state/status do you see?
2. Is the container running?
3. Is the Pod ready?
4. Did the container restart?
5. Why did this happen?
6. Which command would you use to debug it?

So I took the task to be: answer those six questions for all twelve lifecycle
scenarios, then work through each of the four deployment strategies and both
troubleshooting drills, in each case explaining what the manifest is trading away
rather than only that it works.

---

## Table of Contents

1. [Environment assumptions](#1-environment-assumptions)
2. [The core objects and when to reach for each](#2-the-core-objects-and-when-to-reach-for-each)
3. [Pod lifecycle: the 12 scenarios answered](#3-pod-lifecycle-the-12-scenarios-answered)
4. [Deployment strategy 1 — Rolling Update](#4-deployment-strategy-1--rolling-update)
5. [Deployment strategy 2 — Blue-Green](#5-deployment-strategy-2--blue-green)
6. [Deployment strategy 3 — Canary](#6-deployment-strategy-3--canary)
7. [Deployment strategy 4 — Recreate](#7-deployment-strategy-4--recreate)
8. [Strategy comparison and decision guide](#8-strategy-comparison-and-decision-guide)
9. [Troubleshooting drill 1 — failed rollout and rollback](#9-troubleshooting-drill-1--failed-rollout-and-rollback)
10. [Troubleshooting drill 2 — immutable selector mismatch](#10-troubleshooting-drill-2--immutable-selector-mismatch)
11. [Production hardening checklist](#11-production-hardening-checklist)
12. [Cleanup](#12-cleanup)

---

## 1. Environment assumptions

Any conformant cluster works. The labs were validated on Minikube and kind.

```bash
# Start a cluster with enough headroom for the canary lab (10 pods)
minikube start --cpus=4 --memory=6g

# Confirm the control plane answers and the node is Ready
kubectl cluster-info
kubectl get nodes -o wide
```

Expected:

```text
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane   40s   v1.30.0
```

Keep a second terminal open for the whole session running a live watch — most of
the teaching value in this session is in the *transitions*, not the end state:

```bash
kubectl get pods -w
```

---

## 2. The core objects and when to reach for each

| Object | Guarantees | Rescheduled on node loss? | Stable identity? | Use it for |
| :--- | :--- | :--- | :--- | :--- |
| **Pod** | One scheduling unit, one or more containers sharing a network namespace and volumes | ❌ No — a bare Pod dies with its node | ❌ No | Debug pods, one-shot tasks. **Never** for real workloads |
| **ReplicaSet** | Exactly *N* matching pods exist | ✅ Yes | ❌ No | Almost never directly — Deployments own them |
| **Deployment** | ReplicaSet + versioned rollout history + rollback | ✅ Yes | ❌ No | Every stateless workload |
| **DaemonSet** | Exactly one pod per (matching) node | ✅ Yes | ❌ No | Log shippers, CNI, node exporters, CSI drivers |
| **StatefulSet** | Ordered, named pods (`web-0`, `web-1`) with sticky storage | ✅ Yes | ✅ Yes | Databases, Kafka, ZooKeeper, anything with peer identity |
| **Job / CronJob** | Run-to-completion, retried on failure | ✅ Yes | ❌ No | Migrations, batch, scheduled reports |

### The ownership chain

```text
Deployment  ──owns──►  ReplicaSet (one per pod-template revision)  ──owns──►  Pods
   │                        │
   │                        └── old ReplicaSets are kept (scaled to 0) so rollback is instant
   └── revisionHistoryLimit controls how many are retained (default 10)
```

Prove it on the manifests in this folder:

```bash
kubectl apply -f ../deployment.yml
kubectl get deploy,rs,pod -l app=nginx-deployment -o wide
```

You will see a ReplicaSet whose name is `<deployment-name>-<pod-template-hash>`.
That hash is a stable hash of the pod template — **change the template and you get
a new ReplicaSet; change only `replicas` and you do not.** That single fact
explains why scaling is not a rollout and does not create a revision.

```bash
# Scaling: no new ReplicaSet, no new revision
kubectl scale deployment/nginx-deployment --replicas=5
kubectl rollout history deployment/nginx-deployment

# Template change: new ReplicaSet, new revision
kubectl set image deployment/nginx-deployment nginx=nginx:1.25-alpine
kubectl rollout history deployment/nginx-deployment
```

### Why a bare Pod is not a workload

```bash
kubectl apply -f ../pod.yml
kubectl delete pod nginx-pod
kubectl get pods            # gone forever — nothing recreates it
```

Compare with a ReplicaSet-managed pod:

```bash
kubectl apply -f ../replicaset.yml
kubectl delete pod -l app=nginx --wait=false
kubectl get pods -w         # the ReplicaSet controller immediately creates a replacement
```

**The controller pattern in one sentence:** a controller runs a reconciliation
loop that continuously compares `spec` (what you asked for) with `status` (what
exists) and takes the smallest action that closes the gap.

---

## 3. Pod lifecycle: the 12 scenarios answered

The lab README asks six questions for every scenario:

1. What state/status do you see?
2. Is the container running?
3. Is the Pod ready?
4. Did the container restart?
5. Why did this happen?
6. Which command would you use to debug it?

Answers for all 12 follow. First, the distinction the lab wants you to internalise:

| Layer | Valid values | Where to read it |
| :--- | :--- | :--- |
| **Pod phase** (official, only 5) | `Pending`, `Running`, `Succeeded`, `Failed`, `Unknown` | `kubectl get pod X -o jsonpath='{.status.phase}'` |
| **Container state** (only 3) | `Waiting`, `Running`, `Terminated` | `kubectl get pod X -o jsonpath='{.status.containerStatuses[0].state}'` |
| **STATUS column** (a cosmetic summary — *not* a phase) | `ContainerCreating`, `CrashLoopBackOff`, `ImagePullBackOff`, `Completed`, `Error`, `Terminating`, … | `kubectl get pods` |

`CrashLoopBackOff` is **not** a Pod phase. It is the `reason` field on a
`Waiting` container state, surfaced into the STATUS column by kubectl. Saying
"the pod is in CrashLoopBackOff phase" in an interview is a giveaway.

### The one-liner that shows all three layers at once

```bash
kubectl get pod <pod> -o jsonpath=\
'PHASE={.status.phase}{"\n"}STATE={.status.containerStatuses[0].state}{"\n"}READY={.status.containerStatuses[0].ready}{"\n"}RESTARTS={.status.containerStatuses[0].restartCount}{"\n"}'
```

---

### 3.1 `01-running.yaml` — Running

```bash
kubectl apply -f ../pod-lifecycle/01-running.yaml
kubectl get pod lifecycle-running
```

```text
NAME                READY   STATUS    RESTARTS   AGE
lifecycle-running   1/1     Running   0          8s
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Running`, container state `Running` |
| Container running? | Yes |
| Ready? | Yes — `1/1`. No readiness probe is defined, so Kubernetes defaults `ready=true` as soon as the container starts |
| Restarted? | No, `RESTARTS 0` |
| Why | Image pulled, container process started and stayed up |
| Debug with | `kubectl describe pod lifecycle-running` |

**The subtlety:** `1/1` here does *not* mean the app is healthy. With no readiness
probe, Kubernetes only knows the process exists. A Java app 40 seconds into a
cold start is `1/1 Running` and returning `502` to every request. This is the
single most common cause of "we deployed and users saw errors even though all
pods were green" — and it is why §11 insists on a readiness probe.

---

### 3.2 `02-pending.yaml` — Pending

```bash
kubectl apply -f ../pod-lifecycle/02-pending.yaml
kubectl get pod lifecycle-pending
kubectl describe pod lifecycle-pending | tail -n 10
```

```text
NAME                READY   STATUS    RESTARTS   AGE
lifecycle-pending   0/1     Pending   0          30s
```

```text
Events:
  Type     Reason            Age   From               Message
  ----     ------            ----  ----               -------
  Warning  FailedScheduling  25s   default-scheduler  0/1 nodes are available: 1 Insufficient cpu,
                                                      1 Insufficient memory.
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Pending`, container state `Waiting` |
| Container running? | No — it was never scheduled, so the kubelet never saw it |
| Ready? | No, `0/1` |
| Restarted? | No — you cannot restart what never started |
| Why | The manifest requests more CPU/memory than any single node can offer. The **scheduler** could not find a fitting node |
| Debug with | `kubectl describe pod` → read the `Events` section. `kubectl logs` returns nothing useful here |

**Pending means the scheduler is stuck, not the app.** The full list of causes worth memorising:

| Cause | Confirm with |
| :--- | :--- |
| Insufficient CPU/memory | `kubectl describe node \| grep -A 5 "Allocated resources"` |
| Unsatisfiable `nodeSelector` / affinity | `kubectl get nodes --show-labels` |
| Taint with no matching toleration | `kubectl describe node \| grep Taints` |
| PVC pending (no matching PV / StorageClass) | `kubectl get pvc` |
| Node pressure (disk/PID) | `kubectl describe node \| grep Conditions -A 8` |

---

### 3.3 `03-succeeded.yaml` — Succeeded

```bash
kubectl apply -f ../pod-lifecycle/03-succeeded.yaml
kubectl get pod lifecycle-succeeded
kubectl logs lifecycle-succeeded
kubectl get pod lifecycle-succeeded -o jsonpath='{.status.phase}'
```

```text
NAME                  READY   STATUS      RESTARTS   AGE
lifecycle-succeeded   0/1     Completed   0          12s
```

Phase: `Succeeded`.

| Question | Answer |
| :--- | :--- |
| State/status | STATUS `Completed`, phase `Succeeded`, container state `Terminated` with `exitCode: 0` |
| Container running? | No — it finished |
| Ready? | No, `0/1`. A terminated container is never ready |
| Restarted? | No |
| Why | The command ran to completion and exited `0`, and `restartPolicy` is not `Always` |
| Debug with | `kubectl logs lifecycle-succeeded` (logs survive until the pod object is deleted) |

`restartPolicy` decides whether `Succeeded` is even reachable:

| `restartPolicy` | exit 0 | exit ≠ 0 | Terminal phase possible? |
| :--- | :--- | :--- | :--- |
| `Always` (default for Deployments) | restart | restart | ❌ Never terminal |
| `OnFailure` | stop → `Succeeded` | restart | ✅ `Succeeded` only |
| `Never` | stop → `Succeeded` | stop → `Failed` | ✅ Both |

This is why a Deployment can never run a batch job: `Always` means a
successfully-finished container is restarted forever, producing
`CrashLoopBackOff` on a program that worked perfectly. Use a **Job**.

---

### 3.4 `04-failed.yaml` — Failed

```bash
kubectl apply -f ../pod-lifecycle/04-failed.yaml
kubectl get pod lifecycle-failed
kubectl get pod lifecycle-failed -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}'
```

```text
NAME               READY   STATUS   RESTARTS   AGE
lifecycle-failed   0/1     Error    0          10s
```

Phase: `Failed`. Exit code: non-zero.

| Question | Answer |
| :--- | :--- |
| State/status | STATUS `Error`, phase `Failed`, container `Terminated` with a non-zero exit code |
| Container running? | No |
| Ready? | No |
| Restarted? | No — `restartPolicy: Never` |
| Why | The container's command exited non-zero and the policy forbids a restart |
| Debug with | `kubectl logs lifecycle-failed` then the `exitCode` jsonpath above |

**Exit codes you must be able to read on sight:**

| Code | Meaning | Usual fix |
| :--- | :--- | :--- |
| `0` | Clean exit | — |
| `1` | Generic application error | Read the logs |
| `126` | Command found but not executable | `chmod +x`, wrong entrypoint |
| `127` | Command not found | Typo, or binary missing from a slim/distroless image |
| `137` | SIGKILL (128+9) | **OOMKilled** — raise the memory limit or fix the leak |
| `139` | SIGSEGV (128+11) | Segfault — native/binary bug |
| `143` | SIGTERM (128+15) | Normal graceful shutdown during eviction/rollout |

`137` is the one that matters in production. Confirm OOM explicitly rather than
guessing — the exit code alone is ambiguous with an external `kill -9`:

```bash
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}'
# OOMKilled
```

---

### 3.5 `05-crashloopbackoff.yaml` — CrashLoopBackOff

```bash
kubectl apply -f ../pod-lifecycle/05-crashloopbackoff.yaml
kubectl get pod lifecycle-crashloop -w
```

```text
NAME                  READY   STATUS             RESTARTS      AGE
lifecycle-crashloop   0/1     Running            0             2s
lifecycle-crashloop   0/1     Error              0             4s
lifecycle-crashloop   0/1     CrashLoopBackOff   1 (3s ago)    7s
lifecycle-crashloop   0/1     Error              2 (21s ago)   28s
lifecycle-crashloop   0/1     CrashLoopBackOff   2 (12s ago)   40s
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase stays `Running`; container oscillates `Running` → `Terminated` → `Waiting{reason: CrashLoopBackOff}` |
| Container running? | Only in brief bursts between crashes |
| Ready? | No |
| Restarted? | Yes — and the counter climbs continuously |
| Why | The container exits non-zero, `restartPolicy: Always` restarts it, it crashes again. The kubelet applies **exponential backoff** to stop a hot loop |
| Debug with | `kubectl logs lifecycle-crashloop --previous` ← the critical flag |

**Why `--previous` is the whole answer.** `kubectl logs` without it attaches to the
*current* container, which is either sleeping in backoff (no output yet) or two
seconds old. `--previous` reads the logs of the **instance that actually died** —
that is where the stack trace is.

```bash
kubectl logs lifecycle-crashloop --previous
kubectl describe pod lifecycle-crashloop | grep -A 4 "Last State"
```

Backoff doubles: **10s → 20s → 40s → 80s → 160s → 300s (capped)**, and resets after
the container stays up 10 minutes. This is why a crashing pod seems to "slow
down" — nothing is wrong with the cluster, the kubelet is deliberately backing off.

The realistic causes, in the order I check them:

1. **Config missing** — a referenced ConfigMap/Secret key does not exist, so the app
   dies on startup validation. (`kubectl describe pod` shows `CreateContainerConfigError`
   if the whole object is missing.)
2. **Dependency unreachable** — the DB host is wrong; the app exits rather than retries.
3. **OOMKilled on startup** — a JVM heap larger than the memory limit. Check
   `lastState.terminated.reason`.
4. **Liveness probe too aggressive** — see §3.7; the app is fine, the probe is wrong.
5. **A job shoved into a Deployment** — see §3.3.

---

### 3.6 `06-imagepullbackoff.yaml` — ImagePullBackOff

```bash
kubectl apply -f ../pod-lifecycle/06-imagepullbackoff.yaml
kubectl get pod lifecycle-image-error
kubectl describe pod lifecycle-image-error | tail -n 8
```

```text
NAME                    READY   STATUS             RESTARTS   AGE
lifecycle-image-error   0/1     ImagePullBackOff   0          25s
```

```text
Events:
  Type     Reason   Age                From     Message
  ----     ------   ----               ----     -------
  Normal   Pulling  30s                kubelet  Pulling image "nginx:this-tag-does-not-exist"
  Warning  Failed   28s                kubelet  Failed to pull image: manifest for
                                                nginx:this-tag-does-not-exist not found
  Warning  Failed   28s                kubelet  Error: ErrImagePull
  Normal   BackOff  14s (x2 over 27s)  kubelet  Back-off pulling image
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Pending`, container `Waiting{reason: ImagePullBackOff}` |
| Container running? | No — there is no image to run |
| Ready? | No |
| Restarted? | No — restarts count container *starts*, and it never started |
| Why | The tag does not exist in the registry |
| Debug with | `kubectl describe pod` → `Events`. `kubectl logs` is useless: no container ⇒ no logs |

`ErrImagePull` is the **first** failure; `ImagePullBackOff` is the retry state it
degrades into. Distinguishing the four root causes:

| Cause | Event message contains | Fix |
| :--- | :--- | :--- |
| Typo / missing tag | `manifest for … not found` | Fix the tag; verify with `docker manifest inspect <image>` |
| Private registry, no creds | `unauthorized` / `authentication required` | Create an `imagePullSecrets` entry |
| Docker Hub rate limit | `toomanyrequests` | Authenticate, or mirror the image |
| No network/DNS from node | `dial tcp … i/o timeout` | Node egress, proxy, or registry firewall |

Creating the pull secret for the private-registry case:

```bash
kubectl create secret docker-registry regcred \
  --docker-server=registry.example.com \
  --docker-username="$REG_USER" \
  --docker-password="$REG_TOKEN"
```

```yaml
spec:
  imagePullSecrets:
    - name: regcred
```

---

### 3.7 `07-readiness.yaml` — Readiness probe

```bash
kubectl apply -f ../pod-lifecycle/07-readiness.yaml
kubectl get pod lifecycle-readiness -w
```

```text
NAME                  READY   STATUS    RESTARTS   AGE
lifecycle-readiness   0/1     Running   0          5s     <- Running but NOT Ready
lifecycle-readiness   1/1     Running   0          35s    <- probe finally passed
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Running` the whole time; only the READY column changes |
| Container running? | Yes, from second one |
| Ready? | No at first, yes once the probe passes |
| Restarted? | **No — and this is the entire point** |
| Why | The readiness probe failed until the app finished warming up |
| Debug with | `kubectl describe pod lifecycle-readiness` → `Readiness probe failed:` events |

> **`Running != Ready`.** Readiness answers *"should this Pod receive traffic?"*

A failing readiness probe removes the pod's IP from the Service's
`EndpointSlice`, so `kube-proxy` stops sending it traffic — but the container is
left alone. That is the correct behaviour for a pod that is temporarily busy,
warming a cache, or waiting on a dependency.

```bash
# Watch the endpoint list shrink and grow as readiness flips
kubectl get endpointslices -l kubernetes.io/service-name=<svc> -w
```

### The three probes — the table that settles every interview question

| | **Startup** | **Readiness** | **Liveness** |
| :--- | :--- | :--- | :--- |
| Question it answers | "Has it booted yet?" | "Can it take traffic?" | "Is it wedged?" |
| On failure | Kill container | Remove from Service endpoints | **Restart container** |
| Runs when | Until first success only | Entire pod lifetime | After startup probe succeeds |
| Disables others while running | ✅ Yes | — | — |
| Omit it when | Fast starter | Never, for anything serving traffic | Often — see below |

**When *not* to set a liveness probe.** A liveness probe that queries the database
turns a 30-second DB blip into a cluster-wide restart storm: every pod fails,
every pod restarts, the stampede of reconnections keeps the DB down. Liveness
must test only *this process's own* health (is the event loop responsive?) and
never a dependency. If you cannot name the deadlock it detects, leave it out.

---

### 3.8 `08-liveness.yaml` — Liveness probe

```bash
kubectl apply -f ../pod-lifecycle/08-liveness.yaml
kubectl get pod lifecycle-liveness -w
```

```text
NAME                 READY   STATUS    RESTARTS      AGE
lifecycle-liveness   1/1     Running   0             10s
lifecycle-liveness   1/1     Running   1 (2s ago)    47s   <- health file deleted at 20s, probe failed
lifecycle-liveness   1/1     Running   2 (3s ago)    94s
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Running`, but RESTARTS climbs steadily |
| Container running? | Yes — a *new* instance after each restart |
| Ready? | Yes (no readiness probe in this manifest) |
| Restarted? | **Yes — this is the distinguishing signal** |
| Why | The manifest deletes the health file after 20s; the liveness probe then fails `failureThreshold` times in a row and the kubelet restarts the container |
| Debug with | `kubectl describe pod lifecycle-liveness` → `Liveness probe failed: …` and `Killing container` events |

```bash
kubectl describe pod lifecycle-liveness | grep -E "Liveness|Killing|Restart"
```

```text
Liveness:  exec [cat /tmp/healthy] delay=5s timeout=1s period=5s #success=1 #failure=3
Warning  Unhealthy  Liveness probe failed: cat: can't open '/tmp/healthy': No such file or directory
Normal   Killing    Container liveness failed liveness probe, will be restarted
```

**How to tell a liveness bug from an app bug:** restarts that are *periodic and
evenly spaced* almost always mean the probe is misconfigured (too short a
`timeoutSeconds`, too low a `failureThreshold`, or `initialDelaySeconds` shorter
than the real boot time). Restarts at *irregular* intervals under load point at
the app. The time-to-restart is
`initialDelaySeconds + (periodSeconds × failureThreshold)` — budget it against
your true p99 startup time, or replace `initialDelaySeconds` guesswork with a
proper startup probe (§3.9).

---

### 3.9 `09-startup.yaml` — Startup probe

```bash
kubectl apply -f ../pod-lifecycle/09-startup.yaml
kubectl get pod lifecycle-startup -w
```

```text
NAME                READY   STATUS    RESTARTS   AGE
lifecycle-startup   0/1     Running   0          5s
lifecycle-startup   0/1     Running   0          25s
lifecycle-startup   1/1     Running   0          35s    <- startup probe passed at ~30s
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Running`, not ready for ~30s |
| Container running? | Yes |
| Ready? | Only after the startup probe succeeds |
| Restarted? | **No** — and without the startup probe it would have been |
| Why | The app deliberately takes 30s to boot. The startup probe suppresses liveness until boot completes |
| Debug with | `kubectl describe pod lifecycle-startup` → `Startup probe failed` events that stop once it passes |

**The problem the startup probe solves.** A legacy app needs 5 minutes to boot but,
once up, must be restarted within 10 seconds of wedging. Those two requirements
are contradictory for a liveness probe alone:

- `initialDelaySeconds: 300` → satisfies boot, but a wedge at hour 3 goes
  undetected for 5 minutes.
- `initialDelaySeconds: 10` → detects the wedge, but kills the pod during every boot
  → permanent `CrashLoopBackOff` on a perfectly healthy app.

The startup probe decouples them. Give it a generous budget
(`failureThreshold × periodSeconds` ≥ worst-case boot) and keep liveness tight:

```yaml
startupProbe:
  httpGet: { path: /healthz, port: 8080 }
  failureThreshold: 60      # 60 × 5s = 300s of grace for a slow boot
  periodSeconds: 5
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 5          # tight, but only active after startup succeeds
  failureThreshold: 2
```

---

### 3.10 `10-init-container.yaml` — Init container

```bash
kubectl apply -f ../pod-lifecycle/10-init-container.yaml
kubectl get pod lifecycle-init -w
```

```text
NAME             READY   STATUS     RESTARTS   AGE
lifecycle-init   0/1     Init:0/1   0          3s     <- init container running
lifecycle-init   0/1     PodInitializing  0    12s    <- init done, main starting
lifecycle-init   1/1     Running    0          15s
```

| Question | Answer |
| :--- | :--- |
| State/status | `Init:0/1` → `PodInitializing` → `Running`. Phase is `Pending` for the whole init phase |
| Container running? | The **init** container first; the app container only after it exits `0` |
| Ready? | No until the main container starts and passes readiness |
| Restarted? | No (if the init container succeeds) |
| Why | Init containers run sequentially to completion before any app container starts |
| Debug with | `kubectl logs lifecycle-init -c setup` — **the `-c` flag is mandatory**, because by default `kubectl logs` targets app containers only |

```text
Init container runs first
        ↓
Init completes (exit 0)
        ↓
Main container starts
```

If an init container fails, the STATUS becomes `Init:Error` or
`Init:CrashLoopBackOff`, and the app container **never starts** — so `kubectl logs`
with no `-c` returns nothing and looks like a dead end. Always name the container.

Real uses: waiting for a database to accept connections, running schema
migrations exactly once before the app boots, `git clone`-ing config into a
shared `emptyDir`, or setting sysctls with a privileged init container so the app
container can stay unprivileged.

---

### 3.11 `11-multi-container.yaml` — Multi-container Pod

```bash
kubectl apply -f ../pod-lifecycle/11-multi-container.yaml
kubectl get pod lifecycle-multi-container
```

```text
NAME                        READY   STATUS    RESTARTS   AGE
lifecycle-multi-container   2/2     Running   0          20s
```

| Question | Answer |
| :--- | :--- |
| State/status | Phase `Running`, READY `2/2` |
| Container running? | Both, concurrently (unlike init containers, which are sequential) |
| Ready? | Yes — **all** containers must be ready for the pod to be ready |
| Restarted? | No |
| Why | Two containers declared in one `spec.containers` list |
| Debug with | `kubectl logs lifecycle-multi-container -c app` / `-c sidecar` |

```text
One Pod
  ├── app container
  └── sidecar container
  (shared: network namespace → localhost; shared volumes; same lifecycle & node)
```

```bash
kubectl logs lifecycle-multi-container -c app
kubectl logs lifecycle-multi-container -c sidecar
kubectl logs lifecycle-multi-container --all-containers=true --prefix=true
```

**What "shared network namespace" buys you:** the sidecar reaches the app at
`localhost:8080` with no Service, no DNS and no network hop. They cannot,
however, both bind port 8080 — a port collision inside one pod is a real failure
mode.

The `2/2` requirement is a production trap: **one unready sidecar makes the whole
pod unready**, pulling a perfectly healthy app out of the Service endpoints. If
your sidecar is a log shipper whose health has nothing to do with request
serving, do not give it a readiness probe.

Canonical patterns: **sidecar** (log shipper, Envoy/Istio proxy), **adapter**
(reformat the app's metrics into Prometheus format), **ambassador** (a local
proxy so the app can just talk to `localhost:6379` and the ambassador handles
sharding/TLS).

---

### 3.12 `12-termination.yaml` — Graceful termination

```bash
kubectl apply -f ../pod-lifecycle/12-termination.yaml
kubectl get pod lifecycle-termination

# In another terminal:
kubectl get pod lifecycle-termination -w

# Then:
kubectl delete pod lifecycle-termination
```

```text
NAME                    READY   STATUS        RESTARTS   AGE
lifecycle-termination   1/1     Running       0          40s
lifecycle-termination   1/1     Terminating   0          41s
lifecycle-termination   0/1     Terminating   0          43s
```

```bash
kubectl logs lifecycle-termination
# Caught SIGTERM — cleaning up...
# Cleanup done. Exiting.
```

| Question | Answer |
| :--- | :--- |
| State/status | `Running` → `Terminating` → gone. (`Terminating` is a kubectl display value, not a phase — the phase stays `Running` until the object is removed) |
| Container running? | Yes, until it handles SIGTERM and exits |
| Ready? | Removed from endpoints the instant deletion begins |
| Restarted? | No |
| Why | The app installs a SIGTERM handler, cleans up, and exits before the grace period expires |
| Debug with | `kubectl logs` (before the object disappears), `kubectl get pod -w` |

### The shutdown sequence, exactly

```text
kubectl delete pod
   │
   ├──► deletionTimestamp set; pod removed from EndpointSlices  ─┐ these two happen
   │                                                             │ CONCURRENTLY —
   ├──► preStop hook runs (if defined)                           │ hence the race
   │                                                             │ below
   ├──► SIGTERM sent to PID 1  ◄─────────────────────────────────┘
   │
   ├──► grace period ticks (terminationGracePeriodSeconds, default 30s)
   │
   └──► SIGKILL if still alive (exit 143 → 137)
```

**The race that causes 502s during every rolling update.** Endpoint removal is
propagated asynchronously to every `kube-proxy` on every node. SIGTERM, meanwhile,
arrives immediately. So a pod can stop accepting connections *before* the last
node has learned to stop routing to it — and in-flight requests get refused.

The fix is a `preStop` sleep that delays SIGTERM long enough for endpoint
propagation to finish. It is not elegant, and it is what everyone runs in production:

```yaml
spec:
  terminationGracePeriodSeconds: 60   # must exceed preStop + real drain time
  containers:
    - name: web
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "sleep 15"]   # keep serving while endpoints propagate
```

Two more requirements:

- **PID 1 must forward signals.** `command: ["sh", "-c", "myapp"]` makes `sh` PID 1,
  and `sh` does not forward SIGTERM to its child — so your handler never fires and
  every shutdown takes the full grace period then SIGKILL. Use the exec form
  (`command: ["myapp"]`) or a real init like `tini`.
- **`terminationGracePeriodSeconds` must exceed `preStop` + drain time**, or the
  kubelet SIGKILLs you mid-cleanup.

---

## 4. Deployment strategy 1 — Rolling Update

**Manifests:** `01-rolling-update/` — `app-rolling` (4 replicas), Service
`app-rolling-service` on NodePort `30010`.

```bash
kubectl apply -f ../01-rolling-update/deployment-v1.yaml
kubectl apply -f ../01-rolling-update/service.yaml
kubectl rollout status deployment/app-rolling
```

Confirm v1 is serving:

```bash
minikube service app-rolling-service --url
curl -s "$(minikube service app-rolling-service --url)" | grep VERSION
# <p>VERSION: v1</p>
```

Now roll to v2 while watching pods in another terminal:

```bash
kubectl apply -f ../01-rolling-update/deployment-v2.yaml
kubectl rollout status deployment/app-rolling
```

```text
Waiting for deployment "app-rolling" rollout to finish: 1 out of 4 new replicas have been updated...
Waiting for deployment "app-rolling" rollout to finish: 2 out of 4 new replicas have been updated...
Waiting for deployment "app-rolling" rollout to finish: 3 out of 4 new replicas have been updated...
deployment "app-rolling" successfully rolled out
```

### Why this one is zero-downtime

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1          # at most 5 pods exist (4 + 1)
    maxUnavailable: 0    # never fewer than 4 READY pods
```

`maxUnavailable: 0` is the guarantee. Kubernetes must bring a **new** pod to
Ready before it is allowed to terminate an old one, so serving capacity never
drops below 100%. The cost is that the rollout needs room for one extra pod and
proceeds one at a time.

The knobs, and what each trade away:

| Setting | Pods during rollout | Behaviour |
| :--- | :--- | :--- |
| `maxSurge: 1, maxUnavailable: 0` | 4–5 | **Safest.** Zero capacity loss. Slowest. Needs spare quota |
| `maxSurge: 0, maxUnavailable: 1` | 3–4 | No extra pods (good under tight quota) but you run at 75% capacity |
| `maxSurge: 25%, maxUnavailable: 25%` | 3–5 | Kubernetes default. Fast, but briefly degraded |
| `maxSurge: 100%, maxUnavailable: 0` | 4–8 | Fastest possible; doubles cost for the duration |

**The readiness probe is load-bearing here.** Without one, "Ready" means "the
process started", so Kubernetes happily terminates a healthy old pod to make way
for a new one that is not yet serving. `maxUnavailable: 0` then guarantees
nothing at all. The manifest in this folder sets one:

```yaml
readinessProbe:
  httpGet: { path: /, port: 80 }
  initialDelaySeconds: 3
  periodSeconds: 5
```

### Two versions run simultaneously — plan for it

Mid-rollout, v1 and v2 both receive live traffic. That is not a bug, it is the
mechanism, and it constrains what you can ship this way:

- **Database migrations must be backward-compatible.** Add a nullable column; never
  rename or drop one in the same release that reads it. Use expand/contract:
  release N adds the column and writes both, release N+1 reads the new one,
  release N+2 drops the old.
- **API changes must be additive** for the duration of the rollout.
- **Sticky sessions break.** Anything holding server-side state per connection
  needs external session storage.

### Pause, resume, and rollback

```bash
kubectl rollout pause deployment/app-rolling     # freeze mid-rollout to observe metrics
kubectl rollout resume deployment/app-rolling
kubectl rollout history deployment/app-rolling
kubectl rollout undo deployment/app-rolling                    # back one revision
kubectl rollout undo deployment/app-rolling --to-revision=1    # to a specific one
```

Record *why* a revision exists, so `rollout history` is readable months later:

```bash
kubectl annotate deployment/app-rolling \
  kubernetes.io/change-cause="Bump nginx 1.24 -> 1.25 (CVE-2024-XXXX)" --overwrite
```

> `kubectl apply --record` is deprecated; set the `kubernetes.io/change-cause`
> annotation explicitly instead.

Add `progressDeadlineSeconds` so a stuck rollout fails loudly rather than hanging
forever — this is what makes a CI gate on `kubectl rollout status` actually work:

```yaml
spec:
  progressDeadlineSeconds: 600   # mark Progressing=False after 10 min of no progress
```

---

## 5. Deployment strategy 2 — Blue-Green

**Manifests:** `02-blue-green/` — `app-blue` and `app-green` (3 replicas each),
Service `myapp-service` on NodePort `30020`.

The trick is in the labels. Both deployments carry `app: myapp`, but differ on
`slot: blue` / `slot: green`. The Service selects on **both** labels, so the
`slot` value in the Service selector is the traffic switch.

```bash
# 1. Deploy BLUE (current production) and point the Service at it
kubectl apply -f ../02-blue-green/deployment-blue.yaml
kubectl apply -f ../02-blue-green/service-blue.yaml
kubectl rollout status deployment/app-blue

curl -s "$(minikube service myapp-service --url)" | grep -o "BLUE ENVIRONMENT"
# BLUE ENVIRONMENT
```

```bash
# 2. Deploy GREEN alongside it. NO traffic reaches it yet.
kubectl apply -f ../02-blue-green/deployment-green.yaml
kubectl rollout status deployment/app-green

kubectl get pods -l app=myapp -L slot,version
```

```text
NAME                         READY   STATUS    RESTARTS   AGE   SLOT    VERSION
app-blue-7d4b8c9f5-2xk9p     1/1     Running   0          3m    blue    v1
app-blue-7d4b8c9f5-8mnq2     1/1     Running   0          3m    blue    v1
app-blue-7d4b8c9f5-lp4rt     1/1     Running   0          3m    blue    v1
app-green-6c8f9d7b4-4wxz1    1/1     Running   0          40s   green   v2
app-green-6c8f9d7b4-9klm3    1/1     Running   0          40s   green   v2
app-green-6c8f9d7b4-qr7sv    1/1     Running   0          40s   green   v2
```

**Smoke-test green before exposing it** — the whole reason to choose this strategy:

```bash
# Reach green directly, bypassing the live Service
kubectl port-forward deployment/app-green 8081:80 &
curl -s http://localhost:8081 | grep -o "GREEN ENVIRONMENT"
kill %1
```

```bash
# 3. THE SWITCH — atomic, one API call
kubectl patch service myapp-service -p '{"spec":{"selector":{"app":"myapp","slot":"green"}}}'

curl -s "$(minikube service myapp-service --url)" | grep -o "GREEN ENVIRONMENT"
# GREEN ENVIRONMENT
```

```bash
# 4. Instant rollback if anything looks wrong — same call, slot back to blue
kubectl patch service myapp-service -p '{"spec":{"selector":{"app":"myapp","slot":"blue"}}}'
```

### What you are trading

| | Rolling Update | Blue-Green |
| :--- | :--- | :--- |
| Pods needed at peak | N + maxSurge | **2N** |
| Versions live at once | 2 (unavoidable) | **1** (clean cut-over) |
| Rollback time | A full reverse rollout (minutes) | **One selector patch (seconds)** |
| Pre-production smoke test on real infra | ❌ Not possible | ✅ Yes |

Blue-green is the right call when rollback speed dominates cost — payment flows,
anything under a tight SLA, releases that must not have two versions writing to
the same table. It is the wrong call when 2N pods is unaffordable.

**The caveat everyone hits:** the switch is atomic for *new* connections only.
Existing keep-alive connections to blue pods continue until they close. Do not
delete the blue deployment for at least one connection-lifetime after the switch
— which is also exactly the window in which you would want to roll back.

---

## 6. Deployment strategy 3 — Canary

**Manifests:** `03-canary/` — `app-stable` (9 replicas, v1) and `app-canary`
(1 replica, v2), one Service `myapp-canary-service` on NodePort `30030`.

Both deployments share `app: myapp-canary` and differ on `track: stable|canary`.
The Service selects on **only the shared label**, so it picks up all 10 pods, and
`kube-proxy` spreads connections roughly evenly across them.

```bash
kubectl apply -f ../03-canary/deployment-stable.yaml
kubectl apply -f ../03-canary/service.yaml
kubectl rollout status deployment/app-stable

kubectl apply -f ../03-canary/deployment-canary.yaml
kubectl rollout status deployment/app-canary

kubectl get pods -l app=myapp-canary -L track,version
kubectl get endpointslices -l kubernetes.io/service-name=myapp-canary-service
```

You should count **10 endpoints**: 9 stable + 1 canary.

### Prove the ~90/10 split empirically

```bash
URL=$(minikube service myapp-canary-service --url)
for i in $(seq 1 100); do
  curl -s "$URL" | grep -oE "STABLE v1|CANARY v2"
done | sort | uniq -c
```

```text
     91 STABLE v1
      9 CANARY v2
```

Expect roughly 90/10, not exactly — see the caveat below.

### Shifting traffic

The split **is** the replica ratio, so you shift traffic by scaling:

```bash
# 10% -> 20%
kubectl scale deployment/app-canary --replicas=2
kubectl scale deployment/app-stable --replicas=8

# 20% -> 50%
kubectl scale deployment/app-canary --replicas=5
kubectl scale deployment/app-stable --replicas=5

# Promote: canary becomes the whole fleet
kubectl scale deployment/app-canary --replicas=10
kubectl scale deployment/app-stable --replicas=0
```

Abort instantly at any stage — one command, no rollout to wait for:

```bash
kubectl scale deployment/app-canary --replicas=0
```

### Two caveats worth stating plainly

**1. The granularity floor.** Replica-ratio traffic splitting cannot express 1%
without 100 pods. Below ~10% you need Layer-7 splitting — an Ingress with
`nginx.ingress.kubernetes.io/canary-weight`, or a service mesh:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "5"   # true 5%, any replica count
```

**2. It is connection-balanced, not request-balanced.** `kube-proxy` load-balances
*connections*, and HTTP keep-alive means one connection carries many requests. A
client that opens a single connection and sends 1,000 requests sends all 1,000 to
one pod. So the 90/10 split holds across many independent clients, but any single
client may see 100% canary or 100% stable. Never promote a canary on a handful of
manual `curl`s.

**What actually makes a canary work is the observability, not the YAML.** Before
promoting, compare stable vs canary on error rate, p99 latency, saturation and a
business KPI — and define the abort threshold *before* you start:

```bash
# Per-track logs while the canary bakes
kubectl logs -l app=myapp-canary,track=canary --tail=100 -f
kubectl logs -l app=myapp-canary,track=stable --tail=100 -f
```

```promql
# Canary error rate vs stable — the query that should gate promotion
sum(rate(http_requests_total{track="canary",code=~"5.."}[5m]))
  / sum(rate(http_requests_total{track="canary"}[5m]))
```

Automate it with Flagger or Argo Rollouts once the manual version works.

---

## 7. Deployment strategy 4 — Recreate

**Manifests:** `04-recreate/` — `app-recreate` (3 replicas), `strategy: Recreate`.

```bash
kubectl apply -f ../04-recreate/deployment-v1.yaml
kubectl apply -f ../04-recreate/service.yaml
kubectl rollout status deployment/app-recreate
```

Watch the downtime window in one terminal:

```bash
kubectl get pods -l app=app-recreate -w
```

Apply v2 in another:

```bash
kubectl apply -f ../04-recreate/deployment-v2.yaml
```

```text
app-recreate-6b9f7c8d4-2xm9p   1/1     Running       0     2m
app-recreate-6b9f7c8d4-7klq3   1/1     Terminating   0     2m
app-recreate-6b9f7c8d4-2xm9p   1/1     Terminating   0     2m
app-recreate-6b9f7c8d4-9prt5   1/1     Terminating   0     2m
                                        <-- ZERO PODS. THIS IS THE OUTAGE. -->
app-recreate-5d8c6f9b3-4wxz1   0/1     Pending       0     0s
app-recreate-5d8c6f9b3-4wxz1   0/1     ContainerCreating 0 1s
app-recreate-5d8c6f9b3-4wxz1   1/1     Running       0     6s
```

Measure the outage rather than eyeballing it:

```bash
URL=$(minikube service app-recreate-service --url)
while true; do
  printf '%s %s\n' "$(date +%T)" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$URL")"
  sleep 1
done
```

You will see a clean block of `000`/`503` — typically 10–30 seconds — bracketed by
`200`s.

### Why anyone would choose downtime

`Recreate` guarantees **no two versions ever run concurrently**. That is a real
requirement, not a failure to configure something better:

1. **Non-backward-compatible schema migrations.** If v2 renames a column, a v1 pod
   still running will throw on every query. A short planned outage is cheaper than
   corrupt data.
2. **`ReadWriteOnce` volumes.** An RWO PVC attaches to one node at a time. A rolling
   update deadlocks: the new pod cannot attach until the old detaches, and the old
   will not terminate until the new is Ready. `Recreate` is the only strategy that
   works here — and it is the most common reason people hit it by accident.
3. **Exclusive external locks** — a singleton leader, a licensed appliance, a
   scheduler that must not double-fire.
4. **Dev/CI environments** where 20 seconds of downtime costs nothing and halving
   the pod count saves money.

Since downtime is unavoidable, make it short and honest: keep images small and
pre-pulled, keep `terminationGracePeriodSeconds` tight, announce a maintenance
window, and serve a real 503 maintenance page at the Ingress instead of a
connection refusal.

---

## 8. Strategy comparison and decision guide

| | **Rolling Update** | **Blue-Green** | **Canary** | **Recreate** |
| :--- | :--- | :--- | :--- | :--- |
| Downtime | None | None | None | **Yes** |
| Peak pod count | N + surge | **2N** | N (split by ratio) | N |
| Versions live at once | 2 | 1 | 2 | 1 |
| Rollback speed | Minutes (reverse rollout) | **Seconds** (selector patch) | **Seconds** (scale to 0) | Minutes + downtime |
| Blast radius of a bad release | All users, progressively | All users at once, post-switch | **Only the canary %** | All users |
| Real-traffic validation before full exposure | ❌ | ⚠️ Smoke test only | ✅ **Yes** | ❌ |
| Extra infrastructure | None | Double capacity | Metrics + ideally L7 routing | None |
| Native `kind: Deployment` support | ✅ | ❌ (label choreography) | ❌ (two Deployments) | ✅ |

```text
Must v1 and v2 never run at the same time?
│   (breaking schema change, RWO volume, exclusive lock)
├── YES ──► RECREATE (accept and schedule the downtime)
│
└── NO  ──► Is this a high-risk change you want to validate on real traffic?
            │
            ├── YES ──► Do you have per-version metrics and an abort threshold?
            │            ├── YES ──► CANARY
            │            └── NO  ──► Get the metrics first; until then, BLUE-GREEN
            │
            └── NO  ──► Do you need sub-minute rollback and can you afford 2N pods?
                         ├── YES ──► BLUE-GREEN
                         └── NO  ──► ROLLING UPDATE  ◄── the correct default
```

**Default to Rolling Update.** It is native, needs no extra machinery, and is right
for the large majority of changes. Reach for the others only when you can name the
specific requirement that forces them.

---

## 9. Troubleshooting drill 1 — failed rollout and rollback

**Manifest:** `troubleshooting/broken-image.yaml` — deployment `yatri-backend`
pinned to the non-existent tag `yatri-backend:non-existent-tag-v999`.

### Set up a healthy baseline first

The drill only demonstrates anything if there is a working revision to fail away
from and roll back to:

```bash
kubectl create deployment yatri-backend --image=nginx:1.25-alpine --replicas=3
kubectl patch deployment yatri-backend -p \
  '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'
kubectl rollout status deployment/yatri-backend
```

### Break it

```bash
kubectl apply -f ../troubleshooting/broken-image.yaml
kubectl get pods -l app=yatri-backend
```

```text
NAME                             READY   STATUS             RESTARTS   AGE
yatri-backend-6d4c8b9f7-2xk9p    1/1     Running            0          3m
yatri-backend-6d4c8b9f7-7mlq3    1/1     Running            0          3m
yatri-backend-6d4c8b9f7-9prt5    1/1     Running            0          3m
yatri-backend-7f9b5c6d8-4wxz1    0/1     ImagePullBackOff   0          45s   <- the surge pod
```

**Read that carefully: 3 healthy pods are still serving.** The rollout is stuck, not
broken. That is `maxUnavailable: 0` doing its job — Kubernetes refuses to
terminate a working pod until the replacement is Ready, and the replacement will
never be Ready.

```bash
kubectl rollout status deployment/yatri-backend --timeout=60s
```

```text
Waiting for deployment "yatri-backend" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

That non-zero exit is exactly what a CI pipeline should gate on.

### Diagnose

```bash
kubectl get deployment yatri-backend -o jsonpath='{.status.conditions}' | jq
```

```json
[
  { "type": "Available",   "status": "True",  "reason": "MinimumReplicasAvailable" },
  { "type": "Progressing", "status": "False", "reason": "ProgressDeadlineExceeded" }
]
```

`Available=True` + `Progressing=False` is the signature of a stuck-but-safe
rollout. Now find the actual cause:

```bash
kubectl describe pod -l app=yatri-backend | grep -A 5 "Events" | tail -n 8
```

```text
Warning  Failed   kubelet  Failed to pull image "yatri-backend:non-existent-tag-v999":
                           manifest unknown
Warning  Failed   kubelet  Error: ErrImagePull
Normal   BackOff  kubelet  Back-off pulling image "yatri-backend:non-existent-tag-v999"
```

### Roll back

```bash
kubectl rollout history deployment/yatri-backend
```

```text
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

```bash
kubectl rollout undo deployment/yatri-backend
kubectl rollout status deployment/yatri-backend
```

```text
deployment.apps/yatri-backend rolled back
deployment "yatri-backend" successfully rolled out
```

The stuck surge pod is deleted and the old ReplicaSet scales back to 3. **Rollback
is instant because the old ReplicaSet was never deleted** — it was scaled to 0 and
kept. That is the whole reason `revisionHistoryLimit` exists; set it to 0 and you
lose the ability to `rollout undo` at all.

```bash
kubectl get rs -l app=yatri-backend
```

```text
NAME                       DESIRED   CURRENT   READY   AGE
yatri-backend-6d4c8b9f7    3         3         3       8m    <- restored
yatri-backend-7f9b5c6d8    0         0         0       4m    <- broken revision, kept at 0
```

### Lessons

- `maxUnavailable: 0` converts a bad image from an outage into a stalled rollout.
- Set `progressDeadlineSeconds` so the stall is *reported*, not merely survived.
- Never deploy `:latest` — it makes rollback meaningless, because the tag your old
  revision points to may now resolve to different content.
- Validate tags in CI before they reach the cluster:
  `docker manifest inspect "$IMAGE" > /dev/null || exit 1`

---

## 10. Troubleshooting drill 2 — immutable selector mismatch

**Manifest:** `troubleshooting/selector-mismatch.yaml` — `selector.matchLabels` says
`app: correct-app-name`, the pod template says `app: wrong-app-name`.

```bash
kubectl apply -f ../troubleshooting/selector-mismatch.yaml
```

```text
The Deployment "selector-error-demo" is invalid:
spec.template.metadata.labels: Invalid value: map[string]string{"app":"wrong-app-name"}:
`selector` does not match template `labels`
```

**Nothing was created.** This is rejected synchronously by API server validation —
no pods, no ReplicaSet, no partial state. Confirm:

```bash
kubectl get deployment selector-error-demo
# Error from server (NotFound): deployments.apps "selector-error-demo" not found
```

### Why the API server refuses

A Deployment finds its pods *only* by label selector. If the selector could not
match the pods the template creates, the Deployment would spawn pods, fail to see
them, conclude it has 0 replicas, and spawn more — forever. Kubernetes rejects the
manifest rather than allow that runaway loop.

### Fix

Make them match:

```yaml
spec:
  selector:
    matchLabels:
      app: correct-app-name
  template:
    metadata:
      labels:
        app: correct-app-name   # must be a superset of selector.matchLabels
```

The template labels may carry **extra** labels (`version`, `track`, `slot`) — that
is precisely how the blue-green and canary labs work. They must merely be a
superset of the selector.

```bash
kubectl apply -f /tmp/selector-fixed.yaml
kubectl get deploy,rs,pod -l app=correct-app-name
```

### The harder version of this bug

`spec.selector` is **immutable after creation** on Deployments (`apps/v1`). You
cannot edit it later:

```bash
kubectl patch deployment my-app -p '{"spec":{"selector":{"matchLabels":{"app":"renamed"}}}}'
```

```text
The Deployment "my-app" is invalid: spec.selector: Invalid value: ...:
field is immutable
```

To change a selector you must delete and recreate the Deployment. To do so
without downtime:

```bash
# 1. Orphan the running pods so they keep serving while the Deployment goes away
kubectl delete deployment my-app --cascade=orphan

# 2. Recreate with the new selector (it adopts nothing; it creates fresh pods)
kubectl apply -f my-app-new-selector.yaml
kubectl rollout status deployment/my-app

# 3. Once the new pods are Ready and serving, delete the orphans
kubectl delete pods -l app=old-label
```

**Related failure worth knowing:** two Deployments with overlapping selectors will
fight over the same pods, each scaling to satisfy its own replica count. Symptom:
pods being created and deleted in an endless churn with no obvious cause. Audit with:

```bash
kubectl get deploy -A -o custom-columns=\
'NS:.metadata.namespace,NAME:.metadata.name,SELECTOR:.spec.selector.matchLabels'
```

---

## 11. Production hardening checklist

Everything above is lab-grade. This is what the same manifests need before they
belong in a real cluster.

### A complete, production-ready Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: yatri-api
  labels:
    app.kubernetes.io/name: yatri-api
    app.kubernetes.io/version: "2.3.1"
    app.kubernetes.io/component: backend
  annotations:
    kubernetes.io/change-cause: "Bump to 2.3.1 — fixes checkout timeout (JIRA-4821)"
spec:
  replicas: 3
  revisionHistoryLimit: 5          # keep rollback targets, bound etcd growth
  progressDeadlineSeconds: 600     # fail a stuck rollout loudly
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: yatri-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: yatri-api
        app.kubernetes.io/version: "2.3.1"
    spec:
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      # Spread replicas across zones so one AZ failure cannot take all of them
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: yatri-api
      containers:
        - name: api
          # Digest-pinned: immutable and reproducible, unlike any tag
          image: registry.example.com/yatri-api@sha256:3f8a...c1d9
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:            # what the scheduler reserves
              cpu: "100m"
              memory: "256Mi"
            limits:              # the ceiling; memory overrun => OOMKilled
              memory: "512Mi"
              # NOTE: no cpu limit — see the note below
          startupProbe:
            httpGet: { path: /healthz, port: http }
            failureThreshold: 30
            periodSeconds: 5     # up to 150s of boot grace
          readinessProbe:
            httpGet: { path: /ready, port: http }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 15"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp    # readOnlyRootFilesystem needs a writable /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

### The non-obvious choices, justified

**Always set memory `requests` *and* `limits`; think twice about a CPU limit.**
Memory is incompressible — exceed the limit and the kernel OOM-kills you, so the
limit is a genuine safety boundary. CPU is compressible: a CPU *limit* makes the
kernel CFS throttle your process even when the node is idle, which routinely adds
tail latency for no benefit. Set a CPU **request** (for scheduling and fair
share) and omit the limit unless you are in a hard multi-tenant environment that
requires one.

**A PodDisruptionBudget, or node maintenance takes you down.** Probes and
`maxUnavailable` protect you during *your* rollouts. They do nothing during a node
drain, cluster upgrade, or autoscaler scale-down — those are *voluntary
disruptions*, and only a PDB constrains them:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: yatri-api-pdb
spec:
  minAvailable: 2          # or maxUnavailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: yatri-api
```

Do not set `minAvailable` equal to `replicas` — that blocks node drains entirely
and will page someone at 3am.

**Digest pins over tags.** `image: app:v2.3.1` is mutable — anyone can re-push that
tag. `app@sha256:…` cannot change, which is what makes a rollback provably return
to the same bits.

### Checklist

- [ ] `resources.requests` set for CPU and memory on every container
- [ ] `resources.limits` set for memory (CPU limit only with a stated reason)
- [ ] Readiness probe on everything that serves traffic — **non-negotiable**
- [ ] Startup probe on anything slower than ~10s to boot
- [ ] Liveness probe only where you can name the deadlock it detects, and never
      testing a downstream dependency
- [ ] `maxUnavailable: 0` for user-facing services
- [ ] `progressDeadlineSeconds` set, and CI gating on `kubectl rollout status`
- [ ] `preStop` sleep + `terminationGracePeriodSeconds` > preStop + drain
- [ ] PID 1 forwards SIGTERM (exec-form `command`, or `tini`)
- [ ] PodDisruptionBudget for every multi-replica service
- [ ] `topologySpreadConstraints` or anti-affinity across nodes/zones
- [ ] `runAsNonRoot`, `readOnlyRootFilesystem`, `drop: ["ALL"]`
- [ ] Images pinned by digest; never `:latest`
- [ ] `kubernetes.io/change-cause` annotation on every rollout
- [ ] `revisionHistoryLimit` tuned (3–5)
- [ ] Standard `app.kubernetes.io/*` labels for consistent selection and dashboards

---

## 12. Cleanup

```bash
# Pod lifecycle lab
kubectl delete -f ../pod-lifecycle/ --ignore-not-found

# Deployment strategies
kubectl delete -f ../01-rolling-update/ --ignore-not-found
kubectl delete -f ../02-blue-green/   --ignore-not-found
kubectl delete -f ../03-canary/       --ignore-not-found
kubectl delete -f ../04-recreate/     --ignore-not-found

# Troubleshooting drills
kubectl delete deployment yatri-backend selector-error-demo --ignore-not-found

# Root-level core object manifests
kubectl delete -f ../pod.yml -f ../replicaset.yml -f ../deployment.yml \
                -f ../service.yml -f ../hello.yml --ignore-not-found

# Verify nothing is left
kubectl get all
```

To reclaim everything at once, delete the cluster:

```bash
minikube delete
```

---

## Command reference

```bash
# Inspect
kubectl get pods -o wide --show-labels
kubectl get pod <pod> -o jsonpath='{.status.phase}'
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].state}'
kubectl describe pod <pod>
kubectl get events --sort-by=.lastTimestamp | tail -n 20

# Logs
kubectl logs <pod>
kubectl logs <pod> --previous              # the instance that crashed
kubectl logs <pod> -c <container>          # multi-container / init
kubectl logs -l app=<label> --tail=100 -f  # across all matching pods

# Rollouts
kubectl rollout status  deployment/<name>
kubectl rollout history deployment/<name>
kubectl rollout undo    deployment/<name> [--to-revision=N]
kubectl rollout restart deployment/<name>  # re-roll without changing the image
kubectl rollout pause   deployment/<name>
kubectl rollout resume  deployment/<name>

# Live debugging
kubectl exec -it <pod> -- sh
kubectl debug <pod> -it --image=busybox --target=<container>   # ephemeral container
kubectl port-forward deployment/<name> 8080:80

# Scaling
kubectl scale deployment/<name> --replicas=N
kubectl set image deployment/<name> <container>=<image>
```
