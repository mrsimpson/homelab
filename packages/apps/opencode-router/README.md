# @mrsimpson/homelab-app-opencode-router

Per-user isolated [OpenCode](https://opencode.ai) instances on Kubernetes, protected by GitHub OAuth.

## What It Does

Each authenticated user gets their own Pod + PVC, managed dynamically by the router at runtime. The router sits behind oauth2-proxy and reads `X-Auth-Request-Email` to identify users, then reverse-proxies to the matching per-user pod.

## Architecture

```
Internet → Cloudflare Tunnel → Traefik
  ├─ opencode-router.<domain>         → [OAuth2 chain] → Router (port 3000)
  └─ <hash>.opencode-router.<domain>  → [OAuth2 chain] → Router → per-user Pod (port 4096)
```

The **router itself** is deployed as an `ExposedWebApp`, which handles the Deployment, Service, OAuth2-Proxy middlewares, IngressRoutes, DNS, and GHCR pull secret automatically.

This package supplements with app-specific resources:

| Resource | Purpose |
|---|---|
| Namespace (`opencode-router`) | Pre-created with `restricted` PSS, passed to ExposedWebApp |
| ServiceAccount, Role, RoleBinding | Router manages user Pods/PVCs via the K8s API at runtime |
| Secret (`opencode-api-keys`) | Anthropic API key, mounted into user pods |
| ConfigMap (`opencode-config-dir`) | `opencode.json` shared config for user pods |
| Wildcard IngressRoute | `*.opencode-router.<domain>` → router (reuses ExposedWebApp's OAuth2 chain middleware) |
| Wildcard DNS CNAME | Cloudflare record for session subdomains |

Per-user Pods and PVCs are **not Pulumi-managed** — they are created/deleted by the router at runtime via the Kubernetes API.

## Custom Image Dependency

The per-user pods run a **custom-built opencode image** (`ghcr.io/mrsimpson/opencode`) that differs from upstream:

- Runs as UID 1000 with `HOME=/home/opencode` (not root)
- Full `securityContext` for `restricted` PSS compliance
- Includes custom tools (gh, bd, ghostty terminal info)

The router image (`ghcr.io/mrsimpson/opencode-router`) is also custom-built from the `router-webapp` branch of the [opencode fork](https://github.com/mrsimpson/opencode). Build scripts are in `images/opencode-router/build.sh`.

## Usage

```typescript
import { createOpencodeRouter } from "@mrsimpson/homelab-app-opencode-router";

const router = createOpencodeRouter(homelab, {
  routerImage: "ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.1",
  opencodeImage: "ghcr.io/mrsimpson/opencode:1.2.27-homelab.5",
  anthropicApiKey: config.requireSecret("anthropicApiKey"),
  defaultGitRepo: "https://github.com/org/repo",  // optional
  storageSize: "2Gi",                              // optional, default 2Gi
  cloudflare: { zoneId, tunnelCname },              // optional, for wildcard DNS
});
```

## Config Variables

Set via `pulumi config` under the `opencode` namespace:

| Key | Required | Description |
|---|---|---|
| `opencode:routerImage` | Yes | Router container image tag |
| `opencode:opencodeImage` | Yes | Per-user pod container image tag |
| `opencode:anthropicApiKey` | Yes (secret) | Anthropic API key for user pods |
| `opencode:defaultGitRepo` | No | Git repo to auto-clone for new users |
| `opencode:storageSize` | No | PVC size per user (default: `2Gi`) |
