# Homelab: Personal Infrastructure as Code

> Own your software. Control your data. Learn real infrastructure.

Type-safe Kubernetes homelab with Pulumi. Zero inbound ports via Cloudflare Tunnel. Everything version-controlled.

## Quick Start

```bash
# Preview infrastructure changes
npm run preview

# Deploy
npm run up

# Tear down
npm run destroy

# Type-check code
npm run type-check

# Lint code style
npm run lint
```

## Architecture

```
Internet → Cloudflare Edge → Encrypted Tunnel → k3s Cluster → Your Apps
(HTTPS)   (TLS, DDoS)       (outbound-only)    (no ports)
```

**Key Components:**
- **Cloudflare Tunnel**: Secure internet exposure without open ports
- **cert-manager**: Automatic TLS certificates (Let's Encrypt)
- **Traefik Gateway API**: HTTP(S) routing and load balancing with ForwardAuth
- **External Secrets**: Sync secrets from Pulumi ESC/Vault/AWS

## Project Structure

```
homelab/                          ← Pulumi project (root)
├── src/index.ts                 ← Orchestrator entry point
├── Pulumi.yaml                  ← Pulumi config
├── package.json                 ← Dependencies & scripts
│
└── packages/                    ← Reusable libraries
    ├── core/
    │   ├── components/          ← ExposedWebApp, HomelabContext
    │   ├── config/              ← Centralized Pulumi config
    │   └── infrastructure/      ← Cloudflare, cert-manager, ingress, secrets
    │
    ├── stacks/
    │   └── base-infra/          ← Orchestrates core infrastructure
    │
    └── apps/
        └── hello-world/         ← Demo application (extensible pattern)
```

## Key Features

- 🔒 **Secure**: No inbound ports, outbound-only tunnel
- 📝 **Type-Safe**: Pulumi + TypeScript instead of YAML
- 🧩 **Modular**: Reusable components and stacks
- 📦 **Infrastructure-as-Code**: Git-versioned, reproducible
- 🚀 **Production-Ready**: Tested patterns (OAuth, storage, secrets)

## Deploying Personal Apps

### Recommended: `homelab-apps` monorepo pattern

For real personal apps (e.g. LobeHub, Vaultwarden, Gitea) use the dedicated
[`mrsimpson/homelab-apps`](https://github.com/mrsimpson/homelab-apps) monorepo.

**Why a separate repo?**
- One repo → one secret set (`KUBECONFIG`, `PULUMI_ACCESS_TOKEN`, Tailscale OAuth)
- No need to fork upstream projects just to carry deployment code
- Clean separation: this repo is the *framework*, `homelab-apps` is *your apps*

**Structure:**
```
homelab-apps/
├── apps/
│   └── lobehub/          ← each app is a Pulumi project
│       ├── Pulumi.yaml
│       ├── Pulumi.dev.yaml
│       └── src/index.ts  ← uses @mrsimpson/homelab-core-components
└── .github/workflows/
    └── deploy-lobehub.yml  ← calls deploy-to-cluster.yml@main (this repo)
```

**Bootstrap in one command:**
```bash
# from this repo
./scripts/setup-homelab-apps.sh
```

**Adding a new app:** Use the **`deploy-homelab-app` skill** in [`homelab-apps/skills/`](https://github.com/mrsimpson/homelab-apps/tree/main/skills/deploy-homelab-app/SKILL.md) — load it in your AI agent and say *"add a new app to homelab-apps"*. It covers workspace scaffolding, RBAC setup, CI workflow, and security considerations.

### Demo apps (in this repo)

The `packages/apps/` folder contains lightweight framework examples:

```bash
mkdir -p packages/apps/my-app/src
# Create: package.json, tsconfig.json, src/index.ts
npm install
```

Use `@mrsimpson/homelab-core-components`:

```typescript
import { createHomelabContextFromStack } from "@mrsimpson/homelab-core-components";

const homelab = createHomelabContextFromStack(homelabStack);
homelab.createExposedWebApp("my-app", { ... });
```

## Adding Infrastructure

Create new stack in `packages/stacks/my-stack/` following the `base-infra` pattern.

Or extend `packages/core/infrastructure/` for reusable modules.

## Documentation

- **[homelab-apps skills](https://github.com/mrsimpson/homelab-apps/tree/main/skills/)** - AI agent skills for adding and configuring apps (deploy, database, oauth, secrets)
- **[OAuth2-Proxy Authentication](./docs/OAUTH2_PROXY.md)** - GitHub-based authentication system
- **[OAuth2-Proxy Examples](./docs/OAUTH2_PROXY_EXAMPLES.md)** - Step-by-step usage examples
- **[ADRs](./docs/adr/)** - Architecture decisions
- **[How-To Guides](./docs/howto/)** - Setup, deployment, operations
- **[Security Review](./docs/CRITICAL-REVIEW.md)** - Security assessment

## Authentication Systems

This homelab provides two independent authentication systems:

### OAuth2-Proxy (GitHub OAuth)
Protect routes with GitHub authentication for:
- External developers and contributors
- Public/semi-public applications
- Email-based allowlists

See: [OAuth2-Proxy Guide](./docs/OAUTH2_PROXY.md)

### Authelia (Local & LDAP)
Protect routes with local user accounts for:
- Internal tools and dashboards
- Service accounts and automation
- MFA and advanced policies

**Note**: Routes use **one or the other**, never both. Choose based on your needs.

## Quick Reference: Protecting a Route

**With OAuth2-Proxy** (GitHub users):
```yaml
filters:
  - type: ExtensionRef
    extensionRef:
      group: traefik.io
      kind: Middleware
      name: forwardauth-oauth2-users
      namespace: oauth2-proxy  # Note: different namespace!
```

**With Authelia** (Local accounts):
```yaml
filters:
  - type: ExtensionRef
    extensionRef:
      group: traefik.io
      kind: Middleware
      name: forwardauth-authelia
      namespace: traefik-system
```

## Requirements

- Node.js >=24.0.0
- k3s cluster (see `bootstrap/install-k3s.sh`)
- Cloudflare account (for tunnel and DNS)
- Pulumi account (for state management)

## License

MIT
