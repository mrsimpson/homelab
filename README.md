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
- **ingress-nginx**: HTTP(S) routing and load balancing
- **External Secrets**: Sync secrets from Pulumi ESC/Vault/AWS
- **Authelia**: Centralized authentication with SSO and MFA support

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

## Adding Applications

Create new app in `packages/apps/my-app/`:

```bash
mkdir -p packages/apps/my-app/src
# Create: package.json, tsconfig.json, src/index.ts
npm install
```

Use the `HomelabContext` to deploy:

```typescript
import { createMyApp } from "@mrsimpson/homelab-app-my-app";

const myApp = createMyApp(homelab);
export const myAppUrl = myApp.url;
```

### With Authentication

Protect apps with forward authentication:

```typescript
const app = homelab.createExposedWebApp("secure-app", {
  image: "my-image:latest",
  domain: "secure-app.example.com",
  port: 8080,
  requireAuth: true,  // Enable Authelia forward authentication
});
```

Features:
- ✅ Single sign-on across all apps
- ✅ GitHub/Google social login
- ✅ Multi-factor authentication
- ✅ Per-app access policies
- ✅ No per-app configuration needed

See [How to: Use Forward Auth](./docs/howto/use-forward-auth.md) for details.

## Adding Infrastructure

Create new stack in `packages/stacks/my-stack/` following the `base-infra` pattern.

Or extend `packages/core/infrastructure/` for reusable modules.

## Documentation

- **[ADRs](./docs/adr/)** - Architecture decisions
- **[How-To Guides](./docs/howto/)** - Setup, deployment, operations
- **[Security Review](./docs/CRITICAL-REVIEW.md)** - Security assessment

## Requirements

- Node.js >=24.0.0
- k3s cluster (see `bootstrap/install-k3s.sh`)
- Cloudflare account (for tunnel and DNS)
- Pulumi account (for state management)

## License

MIT
