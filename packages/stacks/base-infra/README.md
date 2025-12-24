# @mrsimpson/homelab-base-infra

Orchestration layer that wires up all core infrastructure modules.

## What Goes Here

Foundation infrastructure stack that sets up:
- Cloudflare Tunnel (secure internet exposure)
- cert-manager (automatic TLS certificates)
- ingress-nginx (HTTP(S) routing)
- External Secrets Operator (secret management)

Returns a `HomelabContext` with all infrastructure dependencies injected.

## Usage

```typescript
import { setupBaseInfra } from "@mrsimpson/homelab-base-infra";

const baseInfra = setupBaseInfra();
const homelab = baseInfra.context;

// Use context to deploy applications
const app = homelab.createExposedWebApp("my-app", {...});

// Access infrastructure details
console.log(baseInfra.cloudflare.tunnelCname);
console.log(baseInfra.certManager.clusterIssuerName);
```

## Future Stacks

More stacks can be created following this pattern:

- `monitoring-stack/` - Prometheus, Grafana, alerting
- `database-stack/` - PostgreSQL, Redis, backups
- `storage-stack/` - NFS, S3-compatible, etc.

Each stack would:
1. Wire up related infrastructure components
2. Export a context for applications to use
3. Be composable with other stacks

## Dependencies

- `@mrsimpson/homelab-core-components` - For HomelabContext
- `@mrsimpson/homelab-core-infrastructure` - For individual modules
