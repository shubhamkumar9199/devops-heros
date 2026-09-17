# Session 11 - Kubernetes Services - Task

- **Name:** Shubham Kumar
- **Enrollment No:** 24BCS10320

---

> **Note on verification:** unlike my earlier sessions, the terminal output below
> is **expected output derived from the manifests in this folder, not captured
> from a live run**. I have not yet had a cluster available to execute these
> against. I will replace these blocks with real captures and screenshots once I
> run the labs. Everything else — the manifests, resource names, ports and labels
> — is read directly from the files in this session folder.

---

## What the task asked

This session ships no explicit question list. [`../service.md`](../service.md) is a
reference guide that ends with seven interview questions (Q1–Q7), and
[`../fqdn.md`](../fqdn.md) poses three DNS scenario questions. The session also ships
five working Service examples in [`../01-clusterip/`](../01-clusterip/) through
[`../05-headless/`](../05-headless/), plus a deliberately broken manifest in
[`../troubleshooting/`](../troubleshooting/).

So I took the task to be: work through all five Service types against the supplied
manifests, explain the port model and DNS resolution that make them work, run the
endpoint triage drill, and answer the seven interview questions properly rather
than in one line each.

---

## Table of Contents

1. [Environment setup](#1-environment-setup)
2. [The problem Services solve](#2-the-problem-services-solve)
3. [The four ports — never confuse these again](#3-the-four-ports--never-confuse-these-again)
4. [Type 1 — ClusterIP](#4-type-1--clusterip)
5. [Type 2 — NodePort](#5-type-2--nodeport)
6. [Type 3 — LoadBalancer](#6-type-3--loadbalancer)
7. [Type 4 — ExternalName](#7-type-4--externalname)
8. [Type 5 — Headless](#8-type-5--headless)
9. [Services without selectors](#9-services-without-selectors)
10. [CoreDNS and FQDN resolution](#10-coredns-and-fqdn-resolution)
11. [How traffic actually flows: kube-proxy, iptables, IPVS](#11-how-traffic-actually-flows-kube-proxy-iptables-ipvs)
12. [Troubleshooting drill — empty endpoints](#12-troubleshooting-drill--empty-endpoints)
13. [The seven interview questions, answered in depth](#13-the-seven-interview-questions-answered-in-depth)
14. [Decision guide](#14-decision-guide)
15. [Production hardening checklist](#15-production-hardening-checklist)
16. [Cleanup](#16-cleanup)

---

## 1. Environment setup

```bash
minikube start --cpus=4 --memory=6g
kubectl cluster-info
kubectl get nodes -o wide
```

Two things you will need repeatedly. First, the cluster's Service CIDR — every
ClusterIP you see will come from this range:

```bash
kubectl cluster-info dump | grep -m 1 service-cluster-ip-range
# --service-cluster-ip-range=10.96.0.0/12
```

Second, a client pod with `curl`, `nslookup` and `dig`. The lab ships one:

```bash
kubectl apply -f ../01-clusterip/client-pod.yaml
kubectl wait --for=condition=Ready pod/curl-client --timeout=60s
```

For DNS work specifically, `busybox:1.28` is the conventional choice — later
busybox builds ship a broken `nslookup` that reports failures on valid records:

```bash
kubectl run dnsutils --image=busybox:1.28 --restart=Never -- sleep 3600
kubectl wait --for=condition=Ready pod/dnsutils --timeout=60s
```

---

## 2. The problem Services solve

Pod IPs are ephemeral. Every restart, reschedule, scale event or node failure
hands a pod a brand-new IP. Prove it in 20 seconds:

```bash
kubectl apply -f ../01-clusterip/app-deployment.yaml
kubectl get pods -l app=web-clusterip -o wide
```

```text
NAME                                 READY   STATUS    IP            NODE
web-app-clusterip-6c8f9d7b4-4wxz1    1/1     Running   10.244.0.12   minikube
web-app-clusterip-6c8f9d7b4-9klm3    1/1     Running   10.244.0.13   minikube
web-app-clusterip-6c8f9d7b4-qr7sv    1/1     Running   10.244.0.14   minikube
```

```bash
kubectl delete pod -l app=web-clusterip --wait=false
sleep 15
kubectl get pods -l app=web-clusterip -o wide
```

```text
NAME                                 READY   STATUS    IP            NODE
web-app-clusterip-6c8f9d7b4-2mkp8    1/1     Running   10.244.0.15   minikube   <- all new
web-app-clusterip-6c8f9d7b4-7xnq4    1/1     Running   10.244.0.16   minikube
web-app-clusterip-6c8f9d7b4-b9wtz    1/1     Running   10.244.0.17   minikube
```

Every IP changed. Any client that had hardcoded `10.244.0.12` is now talking to
nothing. A Service gives you four things that fix this:

1. **A stable virtual IP and DNS name** that outlive every pod behind it.
2. **Load balancing** across all healthy matching pods.
3. **Service discovery** — CoreDNS publishes a record the moment the Service exists.
4. **Health awareness** — a pod failing readiness is pulled from the rotation
   automatically, and added back when it recovers.

### The label-selector contract

This is the mechanism underneath all of it, and the source of most Service bugs:

```text
Service.spec.selector  ──matches──►  Pod.metadata.labels
                                           │
              EndpointSlice controller watches for matches
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ Pod matches selector AND is Ready?  │
                        └──────────────────┬──────────────────┘
                                    YES ───┴─── NO
                                     │           │
                          added to EndpointSlice │ excluded
                                     │           │
                        kube-proxy programs iptables/IPVS rules
```

Note the **AND**: matching labels is necessary but not sufficient. A pod that
matches the selector but fails its readiness probe is excluded. Those are the two
independent reasons a Service can have zero endpoints, and §12 shows how to tell
them apart.

---

## 3. The four ports — never confuse these again

```text
 Client (browser / external user)
             │
             ▼  hits Node IP on:
      [ nodePort: 30080 ]        ← open on EVERY worker node (range 30000–32767)
             │
             ▼  forwarded to:
      [ port: 80 ]               ← the Service's own port (cluster-internal)
             │
             ▼  forwarded to:
      [ targetPort: 8080 ]       ← the port your process listens on inside the pod
             │
             ▼
      [ containerPort: 8080 ]    ← documentation only; does NOT open anything
```

| Port | Lives on | Who connects to it | Required? |
| :--- | :--- | :--- | :--- |
| **`nodePort`** | Every worker node's host network | External clients | Only for `NodePort` / `LoadBalancer`; auto-assigned if omitted |
| **`port`** | The Service object (its ClusterIP) | Other pods in the cluster | ✅ Always |
| **`targetPort`** | The pod/container | The Service, when forwarding | Optional — defaults to `port` |
| **`containerPort`** | The pod spec | Nobody. Pure metadata | ❌ Optional |

### The two facts that catch people out

**`containerPort` opens nothing.** It is informational. If your process listens on
8080, it is reachable on 8080 whether or not you declared `containerPort`, and
declaring `containerPort: 9090` does not make 9090 work. Its only real uses are
documentation and giving the port a *name*.

**`targetPort` defaults to `port` when omitted.** This is the single most common
Service bug. The lab's own ClusterIP manifest makes the distinction explicit:

```yaml
# 01-clusterip/service.yaml
ports:
  - name: http
    port: 8080        # clients inside the cluster connect here
    targetPort: 80    # nginx actually listens here
```

Drop `targetPort: 80` and Kubernetes forwards to port 8080 on the pod, where
nothing is listening. You get `connection refused` — with a Service that has
healthy endpoints and looks perfectly fine in `kubectl get svc`.

### Named ports — the version that survives refactoring

Reference a port by name instead of number and you can change the container's
port without touching the Service:

```yaml
# Pod / Deployment
ports:
  - name: http
    containerPort: 8080
---
# Service
ports:
  - port: 80
    targetPort: http    # resolves via the container's port NAME
```

This is also the only way to target different ports on heterogeneous pods behind
one Service. Multi-port Services **must** name every port:

```yaml
ports:
  - name: http          # name is mandatory when there is more than one port
    port: 80
    targetPort: 8080
  - name: metrics
    port: 9090
    targetPort: 9090
```

---

## 4. Type 1 — ClusterIP

**Manifests:** `01-clusterip/` — Deployment `web-app-clusterip` (3 replicas,
label `app: web-clusterip`), Service `web-service-clusterip` (`port: 8080` →
`targetPort: 80`), plus `curl-client`.

The default. An internal virtual IP reachable only from inside the cluster.

```bash
kubectl apply -f ../01-clusterip/app-deployment.yaml
kubectl apply -f ../01-clusterip/service.yaml
kubectl apply -f ../01-clusterip/client-pod.yaml
kubectl rollout status deployment/web-app-clusterip
```

```bash
kubectl get svc web-service-clusterip
```

```text
NAME                    TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
web-service-clusterip   ClusterIP   10.109.42.187   <none>        8080/TCP   12s
```

`EXTERNAL-IP: <none>` is not a pending state — it is permanent and correct. A
ClusterIP Service has no external presence by design.

### Verify endpoints before testing anything

```bash
kubectl get endpointslices -l kubernetes.io/service-name=web-service-clusterip \
  -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{"\t"}{.conditions.ready}{"\n"}{end}'
```

```text
10.244.0.15     true
10.244.0.16     true
10.244.0.17     true
```

Three ready endpoints. **Always check this first** — it separates "the Service is
misconfigured" from "the app is broken" in one command.

### Reach it from inside the cluster

```bash
kubectl exec -it curl-client -- curl -s -o /dev/null -w '%{http_code}\n' \
  http://web-service-clusterip:8080
# 200
```

All four of these are equivalent from a pod in the same namespace:

```bash
kubectl exec -it curl-client -- sh -c '
  curl -s -o /dev/null -w "short name:  %{http_code}\n" http://web-service-clusterip:8080
  curl -s -o /dev/null -w "with ns:     %{http_code}\n" http://web-service-clusterip.default:8080
  curl -s -o /dev/null -w "full FQDN:   %{http_code}\n" http://web-service-clusterip.default.svc.cluster.local:8080
  curl -s -o /dev/null -w "raw IP:      %{http_code}\n" http://10.109.42.187:8080
'
```

### Prove it is unreachable from outside

```bash
minikube ssh -- curl -s --max-time 3 http://10.109.42.187:8080 -o /dev/null -w '%{http_code}\n'
# 200   <- works from the NODE (kube-proxy rules live there)

curl -s --max-time 3 http://10.109.42.187:8080
# curl: (28) Connection timed out   <- fails from your laptop. Expected.
```

The ClusterIP is a **virtual** address. It is not assigned to any network
interface anywhere — `ip addr` on the node will never show it. It exists purely
as a match target in iptables/IPVS rules:

```bash
minikube ssh -- "sudo iptables-save -t nat | grep 10.109.42.187"
```

```text
-A KUBE-SERVICES -d 10.109.42.187/32 -p tcp --dport 8080 -j KUBE-SVC-XXXXXXXX
-A KUBE-SVC-XXXXXXXX -m statistic --mode random --probability 0.33333 -j KUBE-SEP-AAAA
-A KUBE-SVC-XXXXXXXX -m statistic --mode random --probability 0.50000 -j KUBE-SEP-BBBB
-A KUBE-SVC-XXXXXXXX -j KUBE-SEP-CCCC
```

Those probabilities are the load balancing: 1/3, then 1/2 of the remainder, then
the rest — which works out to an even split across three pods.

### Confirm load balancing

```bash
for i in $(seq 1 3); do
  kubectl exec curl-client -- curl -s http://web-service-clusterip:8080 \
    -o /dev/null -w '%{remote_ip}\n'
done
```

Different pod IPs appear across requests. See §6 for why this is *connection*-level
and not request-level balancing.

### Where it is used in production

Everything internal: frontend → backend API calls, internal Redis/PostgreSQL/
Elasticsearch that must never face the internet, and — most importantly — **every
service sitting behind an Ingress Controller**. In a well-built cluster the
overwhelming majority of Services are ClusterIP; one Ingress Controller fronts
them all.

---

## 5. Type 2 — NodePort

**Manifests:** `02-nodeport/` — Deployment (label `app: web-nodeport`), Service
`web-service-nodeport` with `nodePort: 30080`.

```bash
kubectl apply -f ../02-nodeport/app-deployment.yaml
kubectl apply -f ../02-nodeport/service.yaml
kubectl rollout status deployment/web-app-nodeport 2>/dev/null || \
  kubectl get deploy -l app=web-nodeport
```

```bash
kubectl get svc web-service-nodeport
```

```text
NAME                   TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
web-service-nodeport   NodePort   10.104.88.21   <none>        80:30080/TCP   10s
```

Read `80:30080/TCP` as `port:nodePort`. Note the ClusterIP is still allocated —
**NodePort is a superset of ClusterIP**, not an alternative to it. Both access
paths work simultaneously:

```bash
# Internal path — the ClusterIP still works
kubectl exec curl-client -- curl -s -o /dev/null -w '%{http_code}\n' http://web-service-nodeport:80

# External path — via the node
curl -s -o /dev/null -w '%{http_code}\n' "http://$(minikube ip):30080"
# 200
```

### Any node works, whether or not it hosts a pod

This is the part worth understanding. In a 3-node cluster with pods on only one
node, hitting *any* node's IP on 30080 still succeeds: `kube-proxy` runs on every
node and forwards to a pod wherever it lives.

```bash
# Works from every node IP in the cluster
for ip in $(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'); do
  printf '%-16s %s\n' "$ip" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$ip:30080")"
done
```

The cost is a second network hop and, more subtly, **the loss of the client IP**:
the forwarding node SNATs the packet, so your application sees the node's IP
rather than the real client's. If you need the true client IP for rate limiting,
geolocation or audit logs:

```yaml
spec:
  externalTrafficPolicy: Local   # preserves client IP; only routes to LOCAL pods
```

| `externalTrafficPolicy` | Client IP | Extra hop | Risk |
| :--- | :--- | :--- | :--- |
| `Cluster` (default) | ❌ SNAT'd to node IP | Possible | Even spread, but blind to client IP |
| `Local` | ✅ Preserved | Never | **Nodes with no local pod drop the traffic**, and load is uneven — needs a health-checking LB in front |

### The port range, and changing it

Default: **30000–32767** (2768 ports). Change it with an API server flag:

```bash
# On the control plane: /etc/kubernetes/manifests/kube-apiserver.yaml
- --service-node-port-range=25000-32767
```

That is a static pod manifest — editing it restarts the API server. Do not widen
it below 1024 without thinking: those ports require privileged binds and collide
with real system services (22, 80, 443) on every node in the cluster.

```bash
# Requesting a port outside the range is rejected at admission
kubectl patch svc web-service-nodeport -p '{"spec":{"ports":[{"port":80,"nodePort":8080}]}}'
# The Service "web-service-nodeport" is invalid: spec.ports[0].nodePort:
# Invalid value: 8080: provided port is not in the valid range. The range of valid ports is 30000-32767
```

Omit `nodePort` and Kubernetes allocates a free one — which is what you want in
CI, where a hardcoded port collides the moment two branches deploy at once.

### Where it is used in production

Bare-metal and on-prem clusters with no cloud LB API; exposing an Ingress
Controller to a hardware load balancer (F5, HAProxy); and quick local demos.

**Why it is a poor choice for public production:** ugly high ports that users
cannot be given; clients pinned to one node IP fail when that node dies unless
something in front handles failover; and each NodePort opens a port on *every*
node, which is real attack surface. The standard answer is one Ingress Controller
— exposed via LoadBalancer in the cloud, or via a single NodePort on bare metal —
fronting many ClusterIP Services.

---

## 6. Type 3 — LoadBalancer

**Manifests:** `03-loadbalancer/` — Service `web-service-loadbalancer`.

```bash
kubectl apply -f ../03-loadbalancer/app-deployment.yaml
kubectl apply -f ../03-loadbalancer/service.yaml
kubectl get svc web-service-loadbalancer
```

On a cluster with no cloud controller:

```text
NAME                       TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
web-service-loadbalancer   LoadBalancer   10.102.77.45    <pending>     80:31547/TCP   15s
```

**`<pending>` forever is the expected result on vanilla Minikube/kind**, not a
bug. The Service type is a *request* to the cloud controller manager to provision
an external load balancer. With no cloud provider, nobody answers. Note that a
NodePort (`31547`) was allocated anyway — because:

### The Russian-doll principle

```text
LoadBalancer  ⊃  NodePort  ⊃  ClusterIP
```

Creating a LoadBalancer Service creates all three layers:

```text
[Internet client]
       │ :80 / :443
       ▼
[Cloud LB — AWS NLB / GCP LB / Azure LB]   ← the part that costs money
       │ :31547 (nodePort)
       ▼
[Worker node 1 / 2 / 3]
       │ :10.102.77.45 (ClusterIP)
       ▼
[Target pod :80]
```

So even while `EXTERNAL-IP` is `<pending>`, the NodePort and ClusterIP paths work:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://$(minikube ip):31547"
# 200
```

### Getting a real external IP locally

```bash
# Minikube ships a stub cloud controller
minikube tunnel        # run in a separate terminal; needs sudo
kubectl get svc web-service-loadbalancer
```

```text
NAME                       TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
web-service-loadbalancer   LoadBalancer   10.102.77.45   10.102.77.45  80:31547/TCP   3m
```

For bare-metal clusters the production answer is **MetalLB**, which watches for
`type: LoadBalancer` Services and assigns IPs from a pool you configure.

### Cloud provisioning, and the cost trap

```yaml
apiVersion: v1
kind: Service
metadata:
  name: public-storefront
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:us-east-1:...:certificate/..."
    service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
spec:
  type: LoadBalancer
  loadBalancerClass: service.k8s.aws/nlb
  externalTrafficPolicy: Local
  loadBalancerSourceRanges:        # firewall at the LB, not in your app
    - 203.0.113.0/24
  selector:
    app: storefront
  ports:
    - port: 443
      targetPort: 8080
```

**Every `type: LoadBalancer` Service provisions a separate, billed cloud
resource** — roughly $15–30/month each on AWS, before data transfer. Fifty
microservices deployed this way is fifty load balancers and a five-figure annual
bill for something one Ingress Controller does better.

The production pattern, in full:

```text
❌ 50 microservices × type: LoadBalancer  =  50 cloud LBs
✅ 50 microservices × type: ClusterIP
   + 1 Ingress Controller × type: LoadBalancer  =  1 cloud LB
```

The second form is also more capable, because a LoadBalancer Service is Layer 4:
it cannot do path routing (`/api` vs `/app`), host routing
(`api.example.com` vs `www.example.com`), or SSL termination for many domains.

### When a LoadBalancer Service *is* the right answer

Non-HTTP traffic that an Ingress Controller cannot route: game servers, MQTT,
gRPC streaming over raw TCP, SIP/VoIP over UDP, database proxies. Layer 7 routing
is meaningless for those, so Layer 4 is the correct tool.

---

## 7. Type 4 — ExternalName

**Manifests:** `04-externalname/` — Service `external-database-service` pointing
at `nencyravaliya.me`, plus a client pod.

The odd one out: no selector, no ClusterIP, no endpoints, no `kube-proxy`
involvement. It is a CoreDNS CNAME record and nothing else.

```bash
kubectl apply -f ../04-externalname/service.yaml
kubectl apply -f ../04-externalname/client-pod.yaml
kubectl get svc external-database-service
```

```text
NAME                        TYPE           CLUSTER-IP   EXTERNAL-IP        PORT(S)   AGE
external-database-service   ExternalName   <none>       nencyravaliya.me   <none>    8s
```

Note the three `<none>` values — no ClusterIP, no ports. And:

```bash
kubectl get endpoints external-database-service
# Error from server (NotFound): endpoints "external-database-service" not found
```

**No Endpoints object exists at all.** That is the structural difference from
every other type.

### Prove it resolves as a CNAME

```bash
kubectl exec -it dnsutils -- nslookup external-database-service.default.svc.cluster.local
```

```text
Server:    10.96.0.10
Address:   10.96.0.10:53

external-database-service.default.svc.cluster.local  canonical name = nencyravaliya.me
Name:      nencyravaliya.me
Address 1: 185.199.108.153
```

Two hops: CoreDNS returns the CNAME, then the pod's resolver resolves the real
name upstream. Kubernetes never touches the packets — the pod connects **directly**
to the external host.

```bash
kubectl exec -it curl-client -- curl -sI --max-time 5 http://external-database-service | head -n 1
```

### Where it earns its keep

**Environment portability without config changes.** Your app config says
`DB_HOST=db-service` in every environment; only the Service definition differs:

```yaml
# dev — a real in-cluster PostgreSQL pod
apiVersion: v1
kind: Service
metadata: { name: db-service, namespace: dev }
spec:
  type: ClusterIP
  selector: { app: postgres }
  ports: [{ port: 5432 }]
---
# prod — AWS RDS, same name
apiVersion: v1
kind: Service
metadata: { name: db-service, namespace: prod }
spec:
  type: ExternalName
  externalName: yatri-prod.c2x9.us-east-1.rds.amazonaws.com
```

Also: migrating a service out of the cluster without touching a single client
(swap the ClusterIP Service for an ExternalName), and giving third-party APIs
clean internal names so the endpoint is not scattered through your codebase.

### The three limitations that bite

1. **No port remapping.** There is no `port`/`targetPort`. Clients must use the
   external service's real port — `db-service:5432`, not `db-service:80`.
2. **TLS certificates will not match.** The pod connects to
   `yatri-prod.c2x9.rds.amazonaws.com`, so the certificate CN is for that name. An
   HTTPS client using `https://db-service` fails hostname verification. Use the
   real hostname for TLS, or set an explicit SNI/host override.
3. **No health checking and no load balancing.** It is DNS. If the external host is
   down, every client discovers that by timing out.

---

## 8. Type 5 — Headless

**Manifests:** `05-headless/` — StatefulSet `web-stateful` (3 replicas,
`serviceName: web-service-headless`) and Service `web-service-headless` with
`clusterIP: None`.

```bash
kubectl apply -f ../05-headless/service.yaml
kubectl apply -f ../05-headless/app-statefulset.yaml
kubectl rollout status statefulset/web-stateful
kubectl get svc web-service-headless
```

```text
NAME                   TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
web-service-headless   ClusterIP   None         <none>        80/TCP    20s
```

`CLUSTER-IP: None` is the whole configuration. It tells Kubernetes: do not
allocate a VIP, do not program kube-proxy rules, just publish the pod IPs in DNS.

### Ordered, stable pod names

```bash
kubectl get pods -l app=web-headless -o wide
```

```text
NAME             READY   STATUS    RESTARTS   AGE   IP
web-stateful-0   1/1     Running   0          60s   10.244.0.21
web-stateful-1   1/1     Running   0          50s   10.244.0.22
web-stateful-2   1/1     Running   0          40s   10.244.0.23
```

Not random hashes — ordinals, created in order 0 → 1 → 2, each waiting for the
previous to be Ready.

### The DNS difference, side by side

```bash
# ClusterIP Service: ONE A record, the virtual IP
kubectl exec -it dnsutils -- nslookup web-service-clusterip.default.svc.cluster.local
```

```text
Name:      web-service-clusterip.default.svc.cluster.local
Address 1: 10.109.42.187
```

```bash
# Headless Service: ONE A RECORD PER READY POD
kubectl exec -it dnsutils -- nslookup web-service-headless.default.svc.cluster.local
```

```text
Name:      web-service-headless.default.svc.cluster.local
Address 1: 10.244.0.21 web-stateful-0.web-service-headless.default.svc.cluster.local
Address 2: 10.244.0.22 web-stateful-1.web-service-headless.default.svc.cluster.local
Address 3: 10.244.0.23 web-stateful-2.web-service-headless.default.svc.cluster.local
```

The client gets the full membership list and decides for itself which peer to
contact. That is exactly what a distributed database needs.

### Per-pod DNS: the reason StatefulSets exist

```text
<pod-name>.<headless-service>.<namespace>.svc.cluster.local
```

```bash
kubectl exec -it dnsutils -- nslookup web-stateful-0.web-service-headless.default.svc.cluster.local
kubectl exec -it dnsutils -- nslookup web-stateful-1.web-service-headless.default.svc.cluster.local
```

Each resolves to exactly one pod. Address a *specific* replica — impossible with
a normal Service, and required by anything with leader/follower roles:

```bash
kubectl exec -it curl-client -- sh -c '
  for i in 0 1 2; do
    echo "web-stateful-$i => $(curl -s -o /dev/null -w "%{http_code}" \
      http://web-stateful-$i.web-service-headless:80)"
  done
'
```

This is what makes a Kafka `bootstrap.servers` list, a MongoDB replica-set config
or a Cassandra seed list possible:

```properties
bootstrap.servers=kafka-0.kafka-headless.prod.svc.cluster.local:9092,\
kafka-1.kafka-headless.prod.svc.cluster.local:9092,\
kafka-2.kafka-headless.prod.svc.cluster.local:9092
```

**The identity is stable across restarts.** Delete `web-stateful-1` and it comes
back as `web-stateful-1`, reattached to the same PVC, resolving on the same DNS
name — with a new IP that DNS updates automatically. Peers reconnect without
reconfiguration.

```bash
kubectl delete pod web-stateful-1
kubectl wait --for=condition=Ready pod/web-stateful-1 --timeout=90s
kubectl get pod web-stateful-1 -o wide   # same name, new IP
```

### Two things to know before you rely on it

**DNS caching is now your problem.** With no VIP, clients resolve pod IPs directly
and many runtimes (notably the JVM, historically `networkaddress.cache.ttl=-1`)
cache them forever. A pod reschedules, its IP changes, and the client keeps
dialling a dead address. Either configure a short DNS TTL in the client or use a
library that re-resolves.

**`publishNotReadyAddresses` for peer discovery.** By default, only *Ready* pods
appear in DNS — which deadlocks a cluster forming for the first time, because no
node can become Ready until it finds its peers, and no peer is published until it
is Ready:

```yaml
spec:
  clusterIP: None
  publishNotReadyAddresses: true   # publish peers before they are Ready
```

### Client-side load balancing

The second use case: gRPC. gRPC multiplexes many requests over one long-lived
HTTP/2 connection, so `kube-proxy`'s connection-level balancing pins a client to
one pod permanently. A headless Service plus a gRPC name resolver lets the client
open a connection to *every* backend and balance per-RPC.

---

## 9. Services without selectors

A Service with no `selector` gets a ClusterIP and DNS name, but Kubernetes will
not populate its endpoints — you do that yourself. This routes cluster traffic to
something outside the cluster while it looks and behaves like an ordinary
internal Service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: legacy-db
spec:
  ports:
    - protocol: TCP
      port: 3306
      targetPort: 3306
  # NO selector — you own the endpoints
```

The modern companion object is an `EndpointSlice` (the `Endpoints` API is legacy;
both still work):

```yaml
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: legacy-db-1
  labels:
    kubernetes.io/service-name: legacy-db   # THIS label binds it to the Service
addressType: IPv4
ports:
  - name: ""
    protocol: TCP
    port: 3306
endpoints:
  - addresses: ["192.168.1.150"]
    conditions:
      ready: true
```

The legacy equivalent, which is what `service.md` shows and what you will still
meet in older manifests:

```yaml
apiVersion: v1
kind: Endpoints
metadata:
  name: legacy-db       # MUST equal the Service name exactly
subsets:
  - addresses:
      - ip: 192.168.1.150
    ports:
      - port: 3306
```

```bash
kubectl apply -f legacy-db-service.yaml
kubectl apply -f legacy-db-endpointslice.yaml
kubectl exec -it curl-client -- nc -zv legacy-db 3306
```

Any pod can now use `legacy-db:3306`, and traffic is DNAT'd to `192.168.1.150` by
kube-proxy — exactly like a normal Service.

**Uses:** an on-prem database during a migration; a canary pointing at a fixed
external host; splitting traffic across in-cluster and out-of-cluster backends in
one Service.

**Caveats:** you own the health checking (nothing removes a dead IP for you); the
IPs must be routable from the pod network; and they may not be other Services'
ClusterIPs (that is explicitly unsupported — kube-proxy will not double-DNAT).

---

## 10. CoreDNS and FQDN resolution

### Anatomy

```text
  payment-service  .  production  .  svc  .  cluster.local
  └──────┬───────┘    └────┬────┘    └┬─┘    └──────┬─────┘
    Service name       Namespace    Type       Cluster domain
```

| Segment | Meaning |
| :--- | :--- |
| `payment-service` | `metadata.name` of the Service |
| `production` | the namespace it lives in |
| `svc` | resource type — distinguishes it from `pod` records |
| `cluster.local` | the cluster domain, fixed at cluster creation |

### CoreDNS is a normal Deployment you can inspect

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl get svc  -n kube-system kube-dns
```

```text
NAME       TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)                  AGE
kube-dns   ClusterIP   10.96.0.10   <none>        53/UDP,53/TCP,9153/TCP   20m
```

`10.96.0.10` — conventionally the 10th IP of the Service CIDR — is what every pod
in the cluster uses as its nameserver.

```bash
kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}'
```

```text
.:53 {
    errors
    health { lameduck 5s }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
        pods insecure
        fallthrough in-addr.arpa ip6.arpa
        ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf { max_concurrent 1000 }
    cache 30
    loop
    reload
    loadbalance
}
```

Two plugins matter here: `kubernetes` serves `*.cluster.local` from the API
server, and `forward . /etc/resolv.conf` sends everything else upstream. The
`loop` plugin is what deliberately crashes CoreDNS on a forwarding loop — see Q3
in §10.4.

### Resolution, step by step

```bash
kubectl exec -it curl-client -- cat /etc/resolv.conf
```

```text
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

```text
1. Pod runs: curl http://web-service-clusterip:8080
                    │
2. The name has 0 dots, which is < ndots:5, so glibc tries the SEARCH LIST first
                    │
3. Query 1: web-service-clusterip.default.svc.cluster.local  -> 10.109.42.187 ✅
                    │
4. Pod connects to 10.109.42.187:8080; kube-proxy DNATs to a pod IP
```

### Same namespace vs cross-namespace

```bash
kubectl create namespace dev
kubectl run test-pod --image=busybox:1.28 -n dev --restart=Never -- sleep 3600
kubectl wait --for=condition=Ready pod/test-pod -n dev --timeout=60s

# Short name FAILS from another namespace — it resolves against dev's search path
kubectl exec -n dev test-pod -- nslookup web-service-clusterip
# ** server can't find web-service-clusterip: NXDOMAIN

# Adding the namespace works
kubectl exec -n dev test-pod -- nslookup web-service-clusterip.default

# Full FQDN always works
kubectl exec -n dev test-pod -- nslookup web-service-clusterip.default.svc.cluster.local
```

The short name fails because the pod's search list begins with
`dev.svc.cluster.local`, producing `web-service-clusterip.dev.svc.cluster.local` —
which does not exist. **Rule: same namespace → short name; anything else →
`service.namespace` at minimum.**

### 10.4 The three DNS incidents worth memorising

**Q1 — "My pod in `staging` cannot reach the database in `prod`."**

The app is configured with `DB_HOST=mysql`. From `staging`, that resolves to
`mysql.staging.svc.cluster.local` → NXDOMAIN. Confirm and fix:

```bash
kubectl exec -n staging <pod> -- nslookup mysql            # NXDOMAIN
kubectl exec -n staging <pod> -- nslookup mysql.prod       # resolves
```

Set `DB_HOST=mysql.prod.svc.cluster.local`. Use the full FQDN in config, not the
two-part form — it is unambiguous and immune to search-path surprises.

**Q2 — "What is `ndots:5` and why do senior engineers care?"**

Any name with fewer than 5 dots is treated as partial, so the search list is tried
*first*. For an external call to `api.stripe.com` (2 dots) that means:

```text
1. api.stripe.com.default.svc.cluster.local  -> NXDOMAIN
2. api.stripe.com.svc.cluster.local          -> NXDOMAIN
3. api.stripe.com.cluster.local              -> NXDOMAIN
4. api.stripe.com                            -> ✅ finally
```

Three wasted round-trips per lookup — and with IPv4+IPv6 that is six queries. At
thousands of RPS this measurably loads CoreDNS and adds tail latency. Watch it
happen:

```bash
kubectl exec -it dnsutils -- nslookup -debug api.stripe.com 2>&1 | grep -c NXDOMAIN
```

Two fixes:

```yaml
# Per-pod: lower ndots for workloads that mostly call external services
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"
```

```bash
# Or make the name absolute with a trailing dot — skips the search list entirely
API_URL=https://api.stripe.com./v1/charges
```

Also enable **NodeLocal DNSCache** in any high-throughput cluster: a DaemonSet
DNS cache on each node that removes most of this traffic from CoreDNS.

**Q3 — "CoreDNS is in CrashLoopBackOff."**

Almost always a **DNS forwarding loop**. If the node's `/etc/resolv.conf` points at
`127.0.0.53` (systemd-resolved), CoreDNS inherits that as its upstream, forwards an
unknown query to localhost, receives its own query back, detects the loop via the
`loop` plugin, and exits deliberately rather than melting the node.

```bash
kubectl logs -n kube-system -l k8s-app=kube-dns --previous | grep -i loop
# [FATAL] plugin/loop: Loop (127.0.0.1:55703 -> :53) detected for zone "."
```

Fix by pointing kubelet at the real resolv.conf:

```bash
# /var/lib/kubelet/config.yaml
resolvConf: /run/systemd/resolve/resolv.conf
```

Or hardcode an upstream in the Corefile: `forward . 8.8.8.8 1.1.1.1`.

### Pod DNS records

Every pod also gets an IP-derived name (dots → dashes):

```text
<pod-ip-with-dashes>.<namespace>.pod.cluster.local
# 10.244.0.21 in default  ->  10-244-0-21.default.pod.cluster.local
```

Rarely useful directly — the named StatefulSet records from §8 are what you
actually want.

### DNS triage sequence

```bash
# 1. Is CoreDNS healthy?
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs  -n kube-system -l k8s-app=kube-dns --tail=50

# 2. Does the pod have sane resolver config?
kubectl exec <pod> -- cat /etc/resolv.conf

# 3. Does the Service object exist in the namespace you think?
kubectl get svc -A | grep <service-name>

# 4. Can a known-good name resolve? (isolates DNS from this Service)
kubectl exec <pod> -- nslookup kubernetes.default.svc.cluster.local

# 5. Resolve the target directly
kubectl exec <pod> -- nslookup <service>.<namespace>.svc.cluster.local

# 6. If DNS is fine, the problem is endpoints — go to §12
kubectl get endpointslices -l kubernetes.io/service-name=<service>
```

---

## 11. How traffic actually flows: kube-proxy, iptables, IPVS

The control plane routes no packets. Three components cooperate:

1. **EndpointSlice controller** (control plane) — watches Services and pods, keeps
   the list of Ready pod IPs current.
2. **`kube-proxy`** (DaemonSet, every node) — watches Services and EndpointSlices,
   programs the kernel.
3. **The Linux kernel** — does the actual packet rewriting, at wire speed, with no
   userspace involvement.

```bash
kubectl get daemonset -n kube-system kube-proxy
kubectl logs -n kube-system -l k8s-app=kube-proxy --tail=20
```

### iptables mode (default)

```bash
minikube ssh -- "sudo iptables-save -t nat | grep -c KUBE-"
minikube ssh -- "sudo iptables-save -t nat | grep 10.109.42.187"
```

Chains: `KUBE-SERVICES` (match the ClusterIP) → `KUBE-SVC-*` (pick a backend by
probability) → `KUBE-SEP-*` (DNAT to that pod IP).

The weakness is that iptables rules are evaluated as a **linear list**. At 5,000+
Services the chains grow to tens of thousands of rules, and every *update*
requires rewriting the whole table — so rule-propagation latency, not packet
latency, becomes the bottleneck.

### IPVS mode (large clusters)

```bash
# kube-proxy ConfigMap: mode: "ipvs"
minikube ssh -- "sudo ipvsadm -Ln | head -n 20"
```

IPVS uses kernel hash tables — **O(1)** lookup regardless of Service count — and
offers real scheduling algorithms: `rr`, `lc` (least connection), `wrr`, `sh`
(source hashing, for sticky routing).

| | iptables | IPVS |
| :--- | :--- | :--- |
| Lookup complexity | O(n) | **O(1)** |
| Practical Service ceiling | ~1,000–5,000 | 10,000+ |
| Algorithms | Random only | rr, lc, wrr, sh, dh |
| Update cost | Rewrite the table | Incremental |
| Availability | Everywhere | Needs IPVS kernel modules |

Newer clusters increasingly use **nftables** mode or eBPF-based dataplanes
(Cilium) that replace kube-proxy entirely.

### The consequence you must internalise

**Kubernetes load-balances connections, not requests.** The DNAT decision is made
once, at connection establishment, and every packet on that connection goes to the
same pod. With HTTP keep-alive or gRPC, one connection carries thousands of
requests — all to one pod.

Symptoms this explains:

- A canary at "10%" that one client sees as 0% or 100% (Session 10, §6).
- Wildly uneven pod CPU despite a "balanced" Service.
- A newly scaled-up pod receiving no traffic at all, because every existing
  client already holds a connection to an old pod.

Fixes: disable keep-alive for internal calls (costly), have clients periodically
recycle connections, or use a Layer 7 proxy (Ingress, service mesh) that balances
per-request.

### Session affinity, when you need stickiness

```yaml
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800   # 3h
```

Pins a client IP to one pod. Note it keys on **IP**, so every user behind one
corporate NAT lands on the same pod — a real hot-spotting risk. Prefer external
session storage over affinity whenever you can.

---

## 12. Troubleshooting drill — empty endpoints

**Manifest:** `troubleshooting/empty-endpoints.yaml` — Service
`broken-backend-service` whose selector says `app: wrong-backend-name` while the
pods are labelled `app: yatri-backend`.

### Reproduce

```bash
kubectl create deployment yatri-backend --image=nginx:1.25-alpine --replicas=2
kubectl label deployment yatri-backend app=yatri-backend --overwrite
kubectl apply -f ../troubleshooting/empty-endpoints.yaml
```

```bash
kubectl get svc broken-backend-service
```

```text
NAME                     TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
broken-backend-service   ClusterIP   10.107.55.132   <none>        80/TCP    10s
```

**The Service looks perfectly healthy.** It has a ClusterIP, DNS resolves, nothing
is red. That is what makes this failure mode confusing.

```bash
kubectl get endpoints broken-backend-service
```

```text
NAME                     ENDPOINTS   AGE
broken-backend-service   <none>      25s
```

```bash
kubectl exec -it curl-client -- curl -sv --max-time 5 http://broken-backend-service
# *   Trying 10.107.55.132:80...
# * connect to 10.107.55.132 port 80 failed: Connection refused
```

**DNS resolved fine; the connection was refused.** That pairing — name resolves,
connection refused — is the signature of an empty-endpoints Service. There is no
backend for iptables to DNAT to, so the packet is rejected immediately.

### Diagnose

```bash
# 1. What is the Service looking for?
kubectl get svc broken-backend-service -o jsonpath='{.spec.selector}'
# {"app":"wrong-backend-name"}

# 2. What labels do the pods actually have?
kubectl get pods --show-labels | grep yatri
# yatri-backend-6d4c8b9f7-2xk9p   1/1   Running   app=yatri-backend,pod-template-hash=6d4c8b9f7

# 3. Does anything match the selector? (the decisive command)
kubectl get pods -l app=wrong-backend-name
# No resources found in default namespace.

# 4. describe says it in one line
kubectl describe svc broken-backend-service | grep -E "Selector|Endpoints"
```

```text
Selector:          app=wrong-backend-name
Endpoints:         <none>
```

### Fix

```bash
kubectl patch svc broken-backend-service -p '{"spec":{"selector":{"app":"yatri-backend"}}}'
kubectl get endpoints broken-backend-service
```

```text
NAME                     ENDPOINTS                         AGE
broken-backend-service   10.244.0.31:5000,10.244.0.32:5000   4m
```

Unlike a Deployment's selector, a **Service selector is mutable** — you can patch
it live. That is precisely what makes the blue-green switch in Session 10 work.

### The five causes of `<none>` endpoints

| # | Cause | Diagnostic | Fix |
| :--- | :--- | :--- | :--- |
| 1 | **Selector typo** (this drill) | `kubectl get pods -l <selector>` returns nothing | Correct the selector, or relabel the pods |
| 2 | **No pods running** | `kubectl get pods -l <selector>` shows Pending/Error | Fix the workload first |
| 3 | **Pods not Ready** | Pods show `0/1 Running` | Fix the readiness probe or the app — a non-Ready pod is *deliberately* excluded |
| 4 | **Namespace mismatch** | `kubectl get svc,pods -n <ns>` | A Service only selects pods in **its own namespace**. Cross-namespace selection is impossible |
| 5 | **`targetPort` mismatch** | Endpoints exist but connections are refused | Check the port the process really binds (`kubectl exec -- netstat -tlnp`) |

Cause 3 is the subtle one, and it is worth a separate demonstration because the
symptom is identical while the fix is completely different:

```bash
# A pod that matches the selector but fails readiness is excluded on purpose
kubectl get pods -l app=yatri-backend
# NAME                            READY   STATUS    RESTARTS   AGE
# yatri-backend-6d4c8b9f7-2xk9p   0/1     Running   0          2m     <- 0/1

kubectl get endpointslices -l kubernetes.io/service-name=yatri-backend-service \
  -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]} ready={.conditions.ready}{"\n"}{end}'
# 10.244.0.31 ready=false
```

The pod is listed with `ready=false` and receives no traffic. That is the system
working correctly, not a bug.

### General Service triage, in order

```bash
SVC=broken-backend-service; NS=default

# 1. Does the Service exist?
kubectl get svc "$SVC" -n "$NS"

# 2. Does it have endpoints?  <-- 80% of failures stop here
kubectl get endpointslices -n "$NS" -l kubernetes.io/service-name="$SVC"

# 3. Do the selector and the pod labels agree?
kubectl get svc "$SVC" -n "$NS" -o jsonpath='{.spec.selector}'; echo
kubectl get pods -n "$NS" --show-labels

# 4. Are the matching pods Ready?
kubectl get pods -n "$NS" -l "$(kubectl get svc "$SVC" -n "$NS" \
  -o jsonpath='{range .spec.selector.*}{@}{end}')"

# 5. Is targetPort the port the process really listens on?
kubectl get svc "$SVC" -n "$NS" -o jsonpath='{.spec.ports}'; echo
kubectl exec <pod> -n "$NS" -- netstat -tlnp 2>/dev/null || \
  kubectl exec <pod> -n "$NS" -- ss -tlnp

# 6. Bypass the Service — talk to a pod IP directly.
#    Works => the Service is at fault.  Fails => the app is at fault.
kubectl exec curl-client -- curl -s -o /dev/null -w '%{http_code}\n' http://<pod-ip>:<targetPort>

# 7. Is a NetworkPolicy blocking it?
kubectl get networkpolicy -n "$NS"
```

Step 6 is the one that saves the most time: it cleanly partitions the problem
space into "Service configuration" and "application", and takes five seconds.

---

## 13. The seven interview questions, answered in depth

### Q1 — What is the default Service type if none is specified?

**`ClusterIP`.** Reachable only from inside the cluster.

```bash
kubectl create service clusterip demo --tcp=80:80 --dry-run=client -o yaml | grep type
# type: ClusterIP
```

Worth adding: `ClusterIP` is not merely the default, it is the *base*. NodePort
and LoadBalancer both allocate a ClusterIP underneath (§6). The only types
without one are `ExternalName` and headless.

---

### Q2 — Difference between NodePort and LoadBalancer?

| | NodePort | LoadBalancer |
| :--- | :--- | :--- |
| External address | `<any-node-ip>:<30000–32767>` | A dedicated cloud IP/DNS name |
| Port presented to users | Ugly high port | Clean `80`/`443` |
| Needs a cloud provider | ❌ No | ✅ Yes (or MetalLB on bare metal) |
| Cost | Free | ~$15–30/month per Service |
| Node failure | Clients pinned to that node IP fail | The cloud LB health-checks and reroutes |
| Builds on | ClusterIP | **NodePort**, which builds on ClusterIP |

The relationship is containment, not alternatives: `LoadBalancer ⊃ NodePort ⊃
ClusterIP`. A LoadBalancer Service *is* a NodePort Service with a cloud LB
pointed at the node ports.

The follow-up they are usually fishing for: "so why not use LoadBalancer
everywhere?" — Q4.

---

### Q3 — Why a Headless Service instead of ClusterIP?

Two distinct reasons.

**1. Stable per-pod identity for stateful clusters.** Kafka, Cassandra, MongoDB
replica sets, ZooKeeper and etcd all need to address *specific* peers — leader vs
follower, this shard vs that one. A ClusterIP hides pods behind one VIP and picks
randomly, which is exactly wrong. A headless Service plus a StatefulSet gives
every pod a permanent DNS name (`kafka-0.kafka-headless.prod.svc.cluster.local`)
that survives rescheduling.

**2. Client-side load balancing.** With all pod IPs in DNS, a gRPC or Envoy client
can open connections to every backend and balance **per request** — which
kube-proxy fundamentally cannot do (§11), because it balances per connection.

---

### Q4 — If NodePort and LoadBalancer both expose services, why do we need Ingress?

**Cost and Layer-7 capability.**

**Cost:** 50 microservices as `type: LoadBalancer` is 50 billed cloud load
balancers. One Ingress Controller behind one LoadBalancer fronts all 50.

**Layer 7:** A Service is Layer 4 — it sees TCP ports, not HTTP. It therefore
cannot do:

- **Path routing** — `/api` → backend, `/` → frontend
- **Host routing** — `api.example.com` vs `www.example.com` on one IP
- **TLS termination for many domains**, with SNI and cert-manager
- Header-based routing, rewrites, redirects, weighted canary splits, rate limiting

```text
❌ 3 services, 3 cloud LBs, 3 IPs:
   api.example.com  -> LB1 -> api-service
   web.example.com  -> LB2 -> web-service
   admin.example.com-> LB3 -> admin-service

✅ 3 services, 1 cloud LB, 1 IP:
                    ┌─► /api  -> api-service   (ClusterIP)
   *.example.com ──►│─► /      -> web-service   (ClusterIP)
   (one LB, one IP) └─► admin.* -> admin-service (ClusterIP)
```

Complete answer, worth saying out loud: "Ingress is not a Service type — it is a
Layer 7 HTTP router that sits in front of ClusterIP Services. The Ingress
*Controller* is itself exposed by a Service, normally one LoadBalancer."

---

### Q5 — What happens if a backend pod fails its readiness probe?

The EndpointSlice controller sets that endpoint's `conditions.ready` to `false`
and `kube-proxy` reprograms the node's rules to exclude it. Traffic stops
reaching the pod within seconds.

**The pod is not killed and not restarted.** When the probe passes again the
endpoint is restored automatically.

| | Readiness | Liveness |
| :--- | :--- | :--- |
| On failure | Removed from Service endpoints | **Container restarted** |
| Container killed? | ❌ Never | ✅ Yes |
| Recovers automatically? | ✅ Yes, when the probe passes | Only via restart |

Watch it:

```bash
kubectl get endpointslices -l kubernetes.io/service-name=<svc> -w
```

Design consequence: a readiness probe should fail when the pod *temporarily*
cannot serve — cache warming, a saturated thread pool, a dependency blip. It is
the correct mechanism for shedding load gracefully, and it is also how
`maxUnavailable: 0` rollouts (Session 10) get their zero-downtime guarantee.

---

### Q6 — Default NodePort range, and can it be changed?

**30000–32767** (2768 ports). Yes — via the API server flag:

```bash
--service-node-port-range=25000-32767
```

Set in `/etc/kubernetes/manifests/kube-apiserver.yaml` on the control plane
(editing that static pod manifest restarts the API server), or through your
managed provider's cluster configuration.

Why the range is high by default: ports below 1024 require `CAP_NET_BIND_SERVICE`
and would collide with real node services (22, 80, 443, 6443). Widening downward
risks breaking SSH on every node in the cluster — so widen upward, or not at all.

```bash
kubectl get svc -A -o jsonpath='{range .items[*]}{.spec.ports[*].nodePort}{"\n"}{end}' \
  | grep -v '^$' | sort -n     # audit ports already taken
```

---

### Q7 — `ExternalName` vs a selector-less Service pointing at an external IP?

| | `ExternalName` | Selector-less + manual EndpointSlice |
| :--- | :--- | :--- |
| Mechanism | **DNS CNAME** | **kube-proxy DNAT** (Layer 4) |
| Target | A domain name (FQDN) | IP addresses |
| ClusterIP allocated | ❌ No | ✅ Yes |
| Traffic through cluster network | ❌ No — pod connects directly | ✅ Yes — via kube-proxy rules |
| Port remapping | ❌ Impossible | ✅ `port` → `targetPort` |
| Follows a changing target IP | ✅ Automatically, via DNS | ❌ You must update the endpoints |
| TLS hostname | Matches the real external name | May mismatch — the client dials the Service name |
| Works for a target that has no DNS name | ❌ No | ✅ Yes |

Pick `ExternalName` when the target has a stable DNS name whose IP changes (AWS
RDS, MongoDB Atlas, any SaaS) — DNS tracks it for free.

Pick the selector-less form when the target is a bare IP with no DNS name, when
you need port remapping, or when you need traffic to traverse the cluster network
so that NetworkPolicies and observability apply to it.

---

## 14. Decision guide

```text
Do you need to expose this outside the cluster?
│
├── NO ──► Do you need per-pod identity or client-side load balancing?
│           │   (StatefulSet, Kafka/Cassandra/Mongo, gRPC)
│           ├── YES ──► HEADLESS  (clusterIP: None)
│           └── NO  ──► CLUSTERIP  ◄── the default, and the right answer most of the time
│
└── YES ─► Is the target actually OUTSIDE the cluster?
            │
            ├── YES ──► Does it have a stable DNS name?
            │            ├── YES ──► EXTERNALNAME
            │            └── NO  ──► SELECTOR-LESS SERVICE + manual EndpointSlice
            │
            └── NO  ──► Is it HTTP/HTTPS?
                         ├── YES ──► CLUSTERIP + INGRESS
                         │            (expose ONE Ingress Controller via LoadBalancer)
                         └── NO  ──► (raw TCP/UDP: gaming, MQTT, DB proxy)
                                      ├── Cloud?      ──► LOADBALANCER
                                      └── Bare metal? ──► NODEPORT (or MetalLB + LoadBalancer)
```

### Summary table

| | ClusterIP | NodePort | LoadBalancer | ExternalName | Headless |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Default? | ✅ | ❌ | ❌ | ❌ | ❌ (`clusterIP: None`) |
| ClusterIP allocated | ✅ | ✅ | ✅ | ❌ | ❌ |
| External access | ❌ | ✅ NodeIP:port | ✅ Cloud IP | N/A (redirect) | ❌ |
| Port range | 1–65535 | 30000–32767 | any | n/a | 1–65535 |
| DNS record | 1 A → ClusterIP | 1 A → ClusterIP | 1 A → ClusterIP | CNAME | **N A → pod IPs** |
| Cloud provider needed | ❌ | ❌ | ✅ | ❌ | ❌ |
| Creates endpoints | ✅ | ✅ | ✅ | ❌ | ✅ (pod IPs) |
| Load balanced by | kube-proxy | kube-proxy | Cloud LB + kube-proxy | DNS client | **the client app** |
| Primary use | Internal microservices | Bare metal, Ingress entry | Public L4, Ingress entry | External DB/SaaS | StatefulSets, gRPC |

---

## 15. Production hardening checklist

### A production ClusterIP Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: yatri-api
  labels:
    app.kubernetes.io/name: yatri-api
    app.kubernetes.io/component: backend
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: yatri-api      # precise: never bare `app: api`
  ports:
    - name: http                            # naming is mandatory for multi-port
      port: 80
      targetPort: http                      # by NAME, so container ports can move
      protocol: TCP
    - name: metrics
      port: 9090
      targetPort: metrics
      protocol: TCP
  # Route to a pod on the same node first — cuts a network hop and cross-AZ cost
  internalTrafficPolicy: Local
```

### Default-deny NetworkPolicy

A Service provides **no security whatsoever**. Any pod in the cluster can reach any
ClusterIP unless a NetworkPolicy says otherwise. Start from default-deny:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}          # every pod in the namespace
  policyTypes: ["Ingress"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: yatri-api
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: yatri-frontend
      ports:
        - protocol: TCP
          port: 8080
```

NetworkPolicies require a CNI that enforces them (Calico, Cilium, Weave). On a
CNI that ignores them they apply silently and protect nothing — verify:

```bash
kubectl get networkpolicy -A
kubectl exec <unauthorised-pod> -- curl -s --max-time 3 http://yatri-api   # should time out
```

### Checklist

- [ ] `targetPort` explicitly set, and verified against the port the process binds
- [ ] Ports referenced by **name**, not number, so container ports can change
- [ ] Every port named when the Service exposes more than one
- [ ] Selectors use `app.kubernetes.io/*` labels, specific enough not to over-match
- [ ] ClusterIP is the default choice; a LoadBalancer needs a written justification
- [ ] Exactly one Ingress Controller fronting HTTP Services, not N LoadBalancers
- [ ] `externalTrafficPolicy: Local` where the real client IP matters
- [ ] `internalTrafficPolicy: Local` for chatty same-node traffic (cuts cross-AZ cost)
- [ ] Default-deny NetworkPolicy per namespace, with explicit allows
- [ ] Readiness probes on every backing pod — they *are* the endpoint health signal
- [ ] `preStop` sleep on pods so endpoint removal propagates before SIGTERM
- [ ] Headless + StatefulSet for anything stateful; never a plain Deployment
- [ ] `publishNotReadyAddresses: true` on headless Services used for peer discovery
- [ ] Full FQDNs (`svc.ns.svc.cluster.local`) in config, not short names
- [ ] `ndots` tuned or trailing dots used for external-heavy workloads
- [ ] NodeLocal DNSCache enabled on high-throughput clusters
- [ ] NodePort allocation left to Kubernetes unless a fixed port is truly required

---

## 16. Cleanup

```bash
kubectl delete -f ../01-clusterip/     --ignore-not-found
kubectl delete -f ../02-nodeport/      --ignore-not-found
kubectl delete -f ../03-loadbalancer/  --ignore-not-found
kubectl delete -f ../04-externalname/  --ignore-not-found
kubectl delete -f ../05-headless/      --ignore-not-found
kubectl delete -f ../service/          --ignore-not-found
kubectl delete -f ../deployment/       --ignore-not-found
kubectl delete -f ../dns-test/         --ignore-not-found
kubectl delete -f ../troubleshooting/  --ignore-not-found

kubectl delete deployment yatri-backend --ignore-not-found
kubectl delete pod dnsutils curl-client --ignore-not-found
kubectl delete namespace dev --ignore-not-found

# StatefulSet PVCs are NOT deleted with the StatefulSet — remove them explicitly
kubectl get pvc
kubectl delete pvc -l app=web-headless --ignore-not-found

kubectl get all
```

---

## Command reference

```bash
# Services
kubectl get svc -A -o wide
kubectl describe svc <name>
kubectl get svc <name> -o jsonpath='{.spec.selector}'
kubectl patch  svc <name> -p '{"spec":{"selector":{"app":"correct"}}}'
kubectl expose deployment <name> --port=80 --target-port=8080 --type=ClusterIP

# Endpoints  (the first thing to check, always)
kubectl get endpointslices -l kubernetes.io/service-name=<svc>
kubectl get endpoints <svc>                      # legacy view, still handy
kubectl get endpointslices -l kubernetes.io/service-name=<svc> -w

# DNS
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec <pod> -- nslookup <svc>.<ns>.svc.cluster.local
kubectl exec <pod> -- getent hosts <svc>
kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}'
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50

# Connectivity
kubectl exec <pod> -- curl -sv --max-time 5 http://<svc>:<port>
kubectl exec <pod> -- nc -zv <svc> <port>
kubectl port-forward svc/<name> 8080:80
kubectl run tmp --rm -it --image=nicolaka/netshoot --restart=Never -- bash

# Dataplane
minikube ssh -- "sudo iptables-save -t nat | grep <clusterip>"
minikube ssh -- "sudo ipvsadm -Ln"
kubectl logs -n kube-system -l k8s-app=kube-proxy --tail=50
```
