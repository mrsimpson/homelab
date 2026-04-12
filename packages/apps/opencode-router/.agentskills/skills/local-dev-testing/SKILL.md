---
name: local-dev-testing
description: How to test the opencode-router locally against the real homelab cluster without a Docker build
---

# Local Dev Testing for opencode-router

Use this workflow to test changes to `packages/opencode-router` (in the opencode fork) against
the real cluster without the Docker build + push cycle (which is ~5 min at 2 MB/s).

## Prerequisites

- `kubectl` configured and pointing at the homelab cluster (`kubectl get nodes` works)
- `node` ≥ 22 available locally
- `bun` available locally (used for the opencode monorepo)
- The opencode fork checked out at `~/projects/open-source/opencode` on branch `router-webapp`

## Step 1 — Build the router locally

```bash
cd ~/projects/open-source/opencode/packages/opencode-router
bun run build        # runs tsc; output goes to dist/
```

## Step 2 — Create a kubeconfig scoped to the service account

This gives the local process exactly the same RBAC the in-cluster pod has.

```bash
SA_TOKEN=$(kubectl create token opencode-router -n opencode-router --duration=24h)
CA_DATA=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
API_SERVER=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}')

cat > /tmp/opencode-router-local.kubeconfig << EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${CA_DATA}
    server: ${API_SERVER}
  name: homelab
contexts:
- context:
    cluster: homelab
    namespace: opencode-router
    user: opencode-router-sa
  name: opencode-router-local
current-context: opencode-router-local
users:
- name: opencode-router-sa
  user:
    token: ${SA_TOKEN}
EOF

# Verify
KUBECONFIG=/tmp/opencode-router-local.kubeconfig kubectl get pods -n opencode-router
```

## Step 3 — Start the router locally

Run in a dedicated terminal (it stays in the foreground):

```bash
cd ~/projects/open-source/opencode/packages/opencode-router

KUBECONFIG=/tmp/opencode-router-local.kubeconfig \
OPENCODE_NAMESPACE=opencode-router \
OPENCODE_IMAGE=ghcr.io/mrsimpson/opencode:latest \
OPENCODE_PORT=4096 \
PORT=3002 \
API_KEY_SECRET_NAME=opencode-api-keys \
CONFIG_MAP_NAME=opencode-config-dir \
STORAGE_CLASS=longhorn-uncritical \
STORAGE_SIZE=2Gi \
node dist/index.js
```

Expected output: `opencode-router listening on :3002`

Note: `ANTHROPIC_API_KEY` is **not** needed by the router process itself — it is injected
into the per-user pods via the `opencode-api-keys` Secret that already exists in the cluster.

## Step 4 — Test in a second terminal

Health check:
```bash
curl -s http://localhost:3002/api/status | jq .
# → {"email":"","state":"none"}  (no X-Forwarded-Email header → anonymous)
```

Trigger pod creation with a git repo (the path that was failing with 500):
```bash
curl -s -X POST http://localhost:3002/api/sessions \
  -H 'Content-Type: application/json' \
  -H 'X-Forwarded-Email: testlocal@example.com' \
  --data-raw '{"repoUrl":"https://github.com/mrsimpson/port-a-dice"}' | jq .
# → {"state":"creating"}  (or "running" if pod already exists)
```

Watch the cluster in a third terminal:
```bash
kubectl get pods -n opencode-router -w
# Should see:  opencode-user-<hash>   Init:0/1 → Running
```

## What success looks like

| Signal | Meaning |
|--------|---------|
| POST returns `{"state":"creating"}` | Router accepted the request, pod creation triggered |
| `Init:0/1` → `Running` in kubectl | git-init ran OK, main container started |
| No `violates PodSecurity` 403 in router logs | seccompProfile fix is working |
| No 500 in router logs | Full happy path |

## Common pitfalls

| Problem | Fix |
|---------|-----|
| `listen EADDRINUSE :::3002` | Another process owns the port — `lsof -i :3002` and kill it, or change `PORT=` |
| `Missing required environment variable: OPENCODE_IMAGE` | Don't forget `OPENCODE_IMAGE` in the env |
| SA token expired (24 h) | Re-run Step 2 to generate a fresh token |
| Pod stuck in `Init:Error` | Check init-container logs: `kubectl logs -n opencode-router <pod> -c git-init` |
| 403 `violates PodSecurity` in router logs | A container is missing `seccompProfile: {type: RuntimeDefault}` — check `pod-manager.ts` |

## After validating locally

1. Commit the fix in the opencode fork (`~/projects/open-source/opencode`, branch `router-webapp`)
2. Bump the homelab revision and rebuild: `bash images/opencode-router/build.sh --push --revision <N>`
3. Update Pulumi config: `pulumi config set opencode:routerImage ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.<N>`
4. Deploy: `pulumi up`
