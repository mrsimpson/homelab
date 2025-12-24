# @mrsimpson/homelab-core-infrastructure

Low-level infrastructure modules for the homelab. Each module is independent and can be used separately.

## Modules

### cloudflare/
Cloudflare Tunnel for secure internet exposure without opening firewall ports.

- Manages ZeroTrust Tunnel (persistent outbound connection)
- Deploys cloudflared daemon in k3s
- Routes all traffic through ingress-nginx

**Exports:** `tunnel`, `tunnelId`, `tunnelCname`, `tunnelToken`, `cloudflaredDeployment`

### cert-manager/
Automatic TLS certificate management (Let's Encrypt).

- Installs cert-manager Helm chart
- Configures ClusterIssuer for Let's Encrypt production
- Handles certificate renewal automatically

**Exports:** `certManager`, `letsEncryptIssuer`, `clusterIssuerName`

### ingress-nginx/
HTTP(S) routing and load balancing.

- Installs ingress-nginx Helm chart
- Configured for k3s (hostNetwork + hostPort)
- Default ingress class for all ingress resources

**Exports:** `ingressNginx`, `ingressClass`

### external-secrets/
Secrets syncing from external backends to Kubernetes.

- Installs External Secrets Operator Helm chart
- Configures Pulumi ESC as ClusterSecretStore
- Ready for Vault, AWS Secrets Manager, etc.

**Exports:** `externalSecretsOperator`, `pulumiEscStore`, `externalSecretsNamespace`

## Usage

Import specific modules or re-export everything:

```typescript
import * as infrastructure from "@mrsimpson/homelab-core-infrastructure";

const tunnelCname = infrastructure.tunnelCname;
const ingressNginx = infrastructure.ingressNginx;
```

## Dependencies

Depends on `@mrsimpson/homelab-config` for centralized configuration.
