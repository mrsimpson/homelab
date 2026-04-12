# @mrsimpson/homelab-app-opencode-router

Per-session isolated [OpenCode](https://opencode.ai) instances on Kubernetes, protected by GitHub OAuth.

Each authenticated user gets a dedicated Pod + PVC per (repo, branch) pair, managed dynamically by the router at runtime.

## Architecture

```
Internet → Cloudflare Tunnel → Traefik
  ├─ code.<domain>              → [OAuth2 chain] → Router (port 3000)  ← setup UI + API
  └─ <hash>-oc.<domain>         → [OAuth2 chain] → Router → session Pod (port 4096)
```

Session hostnames (`<hash>-oc.<domain>`) are **first-level subdomains** of the base domain, covered by the existing `*.<domain>` Cloudflare Universal SSL certificate — no Advanced Certificate Manager required.

The **router** is deployed as an `ExposedWebApp`, which handles the Deployment, Service, OAuth2-Proxy middlewares, IngressRoutes, DNS for the main domain, and GHCR pull secret automatically.

The **Cloudflare operator** runs as a sidecar container in the same pod. It watches session pods and creates/deletes per-session DNS records (`<hash>-oc.<domain>`) and Traefik IngressRoutes on demand at runtime.

This package supplements ExposedWebApp with app-specific resources:

| Resource | Purpose |
|---|---|
| Namespace (`opencode-router`) | Pre-created with `restricted` PSS, passed to ExposedWebApp |
| ServiceAccount, Role, RoleBinding | Router manages session Pods/PVCs; operator manages IngressRoutes via K8s API at runtime |
| Secret (`opencode-api-keys`) | Anthropic API key, mounted into session pods |
| ConfigMap (`opencode-config-dir`) | `opencode.json` shared config for session pods |
| Secret (`opencode-router-cf-credentials`) | Cloudflare API token for operator sidecar |

Session Pods, PVCs, DNS records, and IngressRoutes are **not Pulumi-managed** — created/deleted at runtime by the router and operator.

## Custom Image Dependencies

Session pods run a **custom-built opencode image** (`ghcr.io/mrsimpson/opencode`) that differs from upstream:

- Runs as UID 1000 with `HOME=/home/opencode` (not root)
- Full `securityContext` for `restricted` PSS compliance
- Includes custom tools (gh, bd, ghostty terminal info)

The router image (`ghcr.io/mrsimpson/opencode-router`) is custom-built from the `router-webapp` branch of the [opencode fork](https://github.com/mrsimpson/opencode). Build script: `images/opencode-router/build.sh`.

The operator image (`ghcr.io/mrsimpson/opencode-cloudflare-operator`) is built from `images/opencode-cloudflare-operator/`. Build script: `images/opencode-cloudflare-operator/build.sh`.

## Usage

```typescript
import { createOpencodeRouter } from "@mrsimpson/homelab-app-opencode-router";

const router = createOpencodeRouter(homelab, {
  routerImage: "ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.4",
  cfOperatorImage: "ghcr.io/mrsimpson/opencode-cloudflare-operator:0.1.0-homelab.3",
  opencodeImage: "ghcr.io/mrsimpson/opencode:1.2.27-homelab.6",
  anthropicApiKey: config.requireSecret("anthropicApiKey"),
  defaultGitRepo: "https://github.com/org/repo",  // optional
  storageSize: "2Gi",                              // optional, default 2Gi
  cloudflare: {
    zoneId: "...",
    tunnelId: config.requireSecret("cfTunnelId"),
    apiToken: config.requireSecret("cfApiToken"),
  },
});
```

## Config Variables

Set via `pulumi config` under the `code` namespace:

| Key | Required | Description |
|---|---|---|
| `code:routerImage` | Yes | Router container image tag |
| `code:cfOperatorImage` | Yes | Cloudflare operator sidecar image tag |
| `code:opencodeImage` | Yes | Per-session pod container image tag |
| `code:anthropicApiKey` | Yes (secret) | Anthropic API key for session pods |
| `code:defaultGitRepo` | No | Git repo to auto-clone for new sessions |
| `code:storageSize` | No | PVC size per session (default: `2Gi`) |
