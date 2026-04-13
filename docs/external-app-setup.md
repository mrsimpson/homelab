# External App Setup Guide

This guide explains how to deploy an application to the homelab Kubernetes cluster from an external repository. External apps are fully autonomous — they live in their own repo, have their own CI/CD, and manage their own Pulumi stack.

## Prerequisites

- Access to Pulumi Cloud (organization: `mrsimpson`)
- The homelab maintainer has granted you access to the `homelab/shared` ESC environment
- `KUBECONFIG` and `PULUMI_ACCESS_TOKEN` available as CI secrets (see [Consequences in ADR-013](./adr/013-external-app-deployment-with-published-packages-and-esc.md))
- GitHub Container Registry credentials to pull `ghcr.io/mrsimpson/` images

---

## Three-layer configuration model

| Layer | Examples | Where it lives |
|---|---|---|
| Shared infra facts | `tunnelCname`, `tunnelId`, `domain`, `zoneId` | Pulumi StackReference → homelab stack outputs |
| Shared secrets | Cloudflare API token, GHCR credentials | Pulumi ESC environment `homelab/shared` |
| App-specific config | image tag, storage size, app API keys | App's own `Pulumi.dev.yaml` |

---

## Step 1 — Install the core components package

```bash
npm install @mrsimpson/homelab-core-components
```

This package provides:
- `HomelabContext` — wraps the homelab stack outputs and exposes `createExposedWebApp()`
- `ExposedWebApp` — Traefik IngressRoute + Cloudflare DNS + OAuth2-Proxy + ExternalSecrets + Pod Security Standards (~900 lines, reused without duplication)
- `AuthType` enum — `NONE`, `FORWARD`, `OAUTH2_PROXY`

---

## Step 2 — Create `Pulumi.yaml`

Place this at the root of your repository. The `environment` block imports the shared secrets from Pulumi ESC — no need to re-declare Cloudflare or GHCR credentials.

```yaml
name: my-external-app
runtime: nodejs
description: External app deploying to homelab cluster

# Import shared secrets from Pulumi ESC.
# The homelab maintainer manages this environment (see docs/esc-homelab-shared.yaml).
environment:
  - homelab/shared

config:
  # App-specific config — set with: pulumi config set myapp:image ghcr.io/user/app:latest
  myapp:image:
    default: "ghcr.io/user/app:latest"
  myapp:storageSize:
    default: "1Gi"
```

### What the ESC environment provides

After importing `homelab/shared`, your stack automatically has these config values (no `pulumi config set` needed):

| Config key | Description |
|---|---|
| `cloudflare:apiToken` | Cloudflare API token (secret) |
| `ghcr:username` | GHCR pull username |
| `ghcr:token` | GHCR pull token (secret) |
| `homelab:pulumiAccessToken` | Pulumi access token for StackReference |
| `homelab:pulumiOrganization` | Pulumi org name (e.g. `mrsimpson`) |

---

## Step 3 — Create `Pulumi.dev.yaml`

App-specific, non-secret config goes here. This file is committed to your repo (without secrets).

```yaml
config:
  myapp:image: "ghcr.io/mrsimpson/my-app:1.2.3"
  myapp:storageSize: "5Gi"
```

Secrets go in via `pulumi config set --secret`:

```bash
pulumi config set --secret myapp:apiKey "sk-..."
```

---

## Step 4 — Write `index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import { HomelabContext } from "@mrsimpson/homelab-core-components";

const config = new pulumi.Config("myapp");
const homelabConfig = new pulumi.Config("homelab");

// Read shared infra facts from the homelab stack via StackReference.
// Outputs: tunnelId, tunnelCname, cloudflareZoneId, domain
const homelabStack = new pulumi.StackReference(
  `${homelabConfig.require("pulumiOrganization")}/homelab/dev`
);

// Build the HomelabContext that ExposedWebApp needs.
// Values come from the homelab stack outputs — no hardcoding.
const homelabContext = new HomelabContext({
  domain: homelabStack.requireOutput("domain") as pulumi.Output<string>,
  cloudflare: {
    zoneId: homelabStack.requireOutput("cloudflareZoneId") as pulumi.Output<string>,
    tunnelCname: homelabStack.requireOutput("tunnelCname") as pulumi.Output<string>,
    tunnelId: homelabStack.requireOutput("tunnelId") as pulumi.Output<string>,
    apiToken: new pulumi.Config("cloudflare").requireSecret("apiToken"),
  },
});

// Deploy the app. ExposedWebApp handles:
//   - Kubernetes Deployment + Service
//   - Traefik IngressRoute
//   - Cloudflare DNS record via tunnel
//   - TLS certificate (cert-manager)
//   - Optional: OAuth2-Proxy middleware, ExternalSecrets, PVC
const app = homelabContext.createExposedWebApp("my-app", {
  image: config.require("image"),
  domain: `my-app.no-panic.org`,
  port: 3000,
  storage: {
    size: config.get("storageSize") ?? "1Gi",
    storageClass: "longhorn-uncritical",
    mountPath: "/data",
  },
});

export const url = app.url;
```

---

## Step 5 — CI pipeline

Your CI needs two secrets:
- `PULUMI_ACCESS_TOKEN` — from the `homelab/shared` ESC environment (or set separately)
- `KUBECONFIG` — a namespace-scoped kubeconfig provided by the homelab maintainer

Example GitHub Actions workflow:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Deploy with Pulumi
        uses: pulumi/actions@v5
        with:
          command: up
          stack-name: dev
          work-dir: .
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
          KUBECONFIG_DATA: ${{ secrets.KUBECONFIG }}
          # Write KUBECONFIG to a temp file (Pulumi reads it from disk)
          # Add a pre-step: echo "$KUBECONFIG_DATA" | base64 -d > /tmp/kubeconfig
```

---

## What app-specific config you must provide

The following are **not** in `homelab/shared` — they are per-app:

| Config key | How to set | Example |
|---|---|---|
| Your app's image | `pulumi config set myapp:image ghcr.io/...` | `ghcr.io/mrsimpson/my-app:1.2.3` |
| Storage size | `pulumi config set myapp:storageSize 5Gi` | `5Gi` |
| App-specific API keys | `pulumi config set --secret myapp:apiKey sk-...` | Anthropic key, etc. |
| The subdomain | Hardcoded in `index.ts` or via config | `my-app.no-panic.org` |

---

## Namespace ownership convention

To avoid conflicts between the homelab stack and external app stacks:

- **External apps own their namespace.** Your Pulumi stack should create and manage a dedicated namespace (e.g. `my-app`).
- **Homelab owns shared infra.** Do not create Traefik, oauth2-proxy, cert-manager, or Longhorn resources — they are pre-existing.
- **Naming.** Use your app name as a prefix for all resources to avoid collisions.

---

## Requesting access

Contact the homelab maintainer to:
1. Get added to the `homelab` Pulumi organization
2. Get granted read access to the `homelab/shared` ESC environment
3. Get a namespace-scoped `KUBECONFIG` for your app's namespace
4. Confirm your app's subdomain is available under `no-panic.org`

---

## References

- [ADR-013: External App Deployment via Published npm Packages and Pulumi ESC](./adr/013-external-app-deployment-with-published-packages-and-esc.md)
- [ADR-007: Separate App Repositories](./adr/007-separate-app-repositories.md)
- [ADR-008: Secrets Management](./adr/008-secrets-management.md)
- [ESC environment template](./esc-homelab-shared.yaml)
- [Pulumi StackReference docs](https://www.pulumi.com/docs/concepts/stack/#stackreferences)
- [Pulumi ESC docs](https://www.pulumi.com/docs/esc/)
- [npmjs.com: @mrsimpson/homelab-core-components](https://www.npmjs.com/package/@mrsimpson/homelab-core-components)
