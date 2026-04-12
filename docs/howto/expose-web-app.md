# How to Expose a Web App

## Goal

Make a containerized web application accessible from the internet via HTTPS, with automatic TLS, DNS, and optional authentication.

## Prerequisites

- Cluster set up (see [setup-cluster.md](setup-cluster.md))
- Container image (from Docker Hub, GHCR, or your own registry)
- Domain name (apps use subdomains of your configured homelab domain)

## Steps

### 1. Create the App Package

```bash
mkdir -p packages/apps/my-app/src
```

Create `packages/apps/my-app/package.json`:

```json
{
  "name": "@mrsimpson/homelab-app-my-app",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@mrsimpson/homelab-config": "*",
    "@mrsimpson/homelab-core-components": "*"
  },
  "peerDependencies": {
    "@pulumi/pulumi": "^3.137.0",
    "@pulumi/kubernetes": "^4.0.0"
  }
}
```

Create `packages/apps/my-app/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

### 2. Write the App Module

Create `packages/apps/my-app/src/index.ts`:

```typescript
import { homelabConfig } from "@mrsimpson/homelab-config";
import type { HomelabContext, ExposedWebApp } from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

export function createMyApp(homelab: HomelabContext): {
  app: ExposedWebApp;
  url: pulumi.Output<string>;
} {
  const domain = pulumi.interpolate`my-app.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp("my-app", {
    image: "nginxinc/nginx-unprivileged:alpine",
    domain,
    port: 8080,
  });

  return { app, url: pulumi.interpolate`https://${domain}` };
}
```

`homelab.createExposedWebApp()` injects shared infrastructure (Cloudflare DNS, TLS, Gateway API, External Secrets) automatically — you only specify what's unique to your app.

### 3. Wire into the Root Stack

Edit `src/index.ts`:

```typescript
import { createMyApp } from "@mrsimpson/homelab-app-my-app";

const myApp = createMyApp(homelab);
export const myAppUrl = myApp.url;
```

Add the workspace dependency to root `package.json`:

```json
"dependencies": {
  "@mrsimpson/homelab-app-my-app": "*"
}
```

### 4. Deploy

```bash
npm install   # resolve workspace link
pulumi up
```

## What Gets Created

`ExposedWebApp` creates these resources automatically:

1. **Namespace** — with Pod Security Standards labels (unless you pass a pre-created one)
2. **Deployment** — runs your container with security hardening (non-root, drop ALL caps, seccomp)
3. **Service** — ClusterIP, maps port 80 → your container port
4. **Route** — HTTPRoute (Gateway API) or IngressRoute[] (Traefik CRD), depending on auth mode
5. **DNS record** — Cloudflare CNAME pointing to the Cloudflare Tunnel
6. **ExternalSecret** — GHCR pull credentials (when `imagePullSecrets` references `ghcr-pull-secret`)
7. **PVC** — persistent storage (when `storage` is set)

## Authentication

Three modes are available via the `auth` field:

### No auth (default)

```typescript
homelab.createExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain,
  port: 80,
  // auth defaults to AuthType.NONE — public access
});
```

Uses Gateway API HTTPRoute.

### Authelia forward auth

```typescript
import { AuthType } from "@mrsimpson/homelab-core-components";

homelab.createExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain,
  port: 80,
  auth: AuthType.FORWARD,
});
```

Uses Gateway API HTTPRoute with a ForwardAuth middleware pointing to Authelia. Access is controlled via Authelia policies. See [use-forward-auth.md](use-forward-auth.md).

### OAuth2-Proxy (GitHub OAuth)

```typescript
import { AuthType } from "@mrsimpson/homelab-core-components";

homelab.createExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain,
  port: 80,
  auth: AuthType.OAUTH2_PROXY,
  oauth2Proxy: { group: "users" },
});
```

Uses Traefik IngressRoutes with a ForwardAuth → Errors → Chain middleware stack. Authenticates against the centralized oauth2-proxy deployment (GitHub OAuth). Access is controlled by email allowlists per group — see [manage-access-control.md](manage-access-control.md) and [OAUTH2_PROXY.md](../OAUTH2_PROXY.md).

## Common Options

```typescript
homelab.createExposedWebApp("my-app", {
  // Required
  image: "my-image:latest",
  domain: pulumi.interpolate`app.${homelabConfig.domain}`,
  port: 8080,

  // Replicas
  replicas: 2,

  // Persistent storage
  storage: { size: "10Gi", mountPath: "/data", storageClass: "longhorn" },

  // Resources
  resources: {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },

  // Environment variables
  env: [{ name: "DATABASE_URL", value: "postgres://..." }],

  // Container overrides
  command: ["/bin/sh"],
  args: ["-c", "my-entrypoint.sh"],

  // Extra volumes (ConfigMaps, hostPath, etc.)
  extraVolumes: [{ name: "cfg", configMap: { name: "my-config" } }],
  extraVolumeMounts: [{ name: "cfg", mountPath: "/etc/app" }],

  // Init containers
  initContainers: [{ name: "migrate", image: "my-app:latest", command: ["migrate"] }],

  // Service account (must already exist in the namespace)
  serviceAccountName: "my-app",

  // Health probes
  probes: {
    readinessProbe: { httpGet: { path: "/healthz", port: 8080 } },
    livenessProbe: { httpGet: { path: "/healthz", port: 8080 } },
  },

  // Node pinning (required for hostPath volumes)
  nodeSelector: { "kubernetes.io/hostname": "my-node" },

  // Private registry
  imagePullSecrets: [{ name: "ghcr-pull-secret" }],

  // Security
  securityContext: { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 },

  // Pre-created namespace (skip auto-creation)
  namespace: myNamespace,
});
```

## Troubleshooting

### 502 Bad Gateway

```bash
kubectl get pods -n my-app
kubectl logs -n my-app deployment/my-app
```

Common causes: app not listening on the specified port, app crashed, container image wrong.

### 404 Not Found

Check the route was created:

```bash
# For Gateway API (AuthType.NONE or AuthType.FORWARD)
kubectl get httproute -n my-app

# For OAuth2-Proxy (AuthType.OAUTH2_PROXY)
kubectl get ingressroute -n my-app
```

### DNS Not Resolving

```bash
dig app.yourdomain.com
```

DNS propagation can take 30–120 seconds. Verify the Cloudflare DNS record exists in the dashboard.

## Next Steps

- [Add OAuth Protection](add-oauth-protection.md) — protect your app with GitHub OAuth
- [Set Up Persistent Storage](setup-persistent-storage.md) — configure storage for stateful apps
- [Deploy a Database](deploy-database.md) — add a database to your app
