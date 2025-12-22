# ADR 008: Secrets Management with External Secrets Operator

**Status:** Accepted
**Date:** 2024-12-22
**Deciders:** Platform Team

## Context

Applications require secrets (API keys, database passwords, OAuth credentials) that must be:
- Stored securely (encrypted at rest and in transit)
- Accessible to applications running in Kubernetes
- Rotatable (preferably automatically)
- Version-controlled (change history)
- Auditable (who accessed what, when)

Current approach uses Pulumi encrypted config (`pulumi config set --secret`), which:
- ✅ Works with existing workflow
- ✅ Encrypted in stack files
- ❌ No automatic rotation
- ❌ No centralized management across apps
- ❌ Hard to share secrets between stacks
- ❌ Rotation requires manual Pulumi updates

## Decision

**Use External Secrets Operator (ESO) with flexible backend strategy.**

Initial implementation uses Pulumi ESC backend, with clear migration path to add rotation-capable backends (Vault, cloud providers) as needed.

### Architecture

```
┌─────────────────────────────────────────────┐
│ Application Pods                             │
│ ↓ reads                                      │
│ Kubernetes Secrets (synced)                  │
│ ↑ synced by                                  │
│ External Secrets Operator                    │
│ ↑ pulls from                                 │
│ Backend Store (Pulumi ESC / Vault / AWS)    │
└─────────────────────────────────────────────┘
```

### Implementation Phases

**Phase 1: ESO + Pulumi ESC** (Immediate)
- Deploy External Secrets Operator to cluster
- Configure Pulumi ESC as secret backend
- Migrate apps to use ExternalSecret CRDs
- Secrets automatically synced from Pulumi config to k8s

**Phase 2: Add Rotation Backends** (When Needed)
- For database credentials: Add AWS Secrets Manager or Vault
- For static secrets: Keep Pulumi ESC
- Multiple backends coexist via different ClusterSecretStores

### Secret Categories and Rotation Strategy

| Secret Type | Rotation Need | Backend | Auto-Rotation |
|-------------|--------------|---------|---------------|
| Database passwords | High | Vault or AWS SM | ✅ Yes (dynamic) |
| API keys (3rd party) | Medium | Pulumi ESC or Vault | ⚠️ Manual/scripted |
| OAuth client secrets | Low | Pulumi ESC | ⚠️ Manual (rare) |
| TLS certificates | N/A | cert-manager | ✅ Yes (separate system) |
| Cookie secrets | Low | Pulumi ESC | ⚠️ Manual (scheduled) |
| Cloudflare API token | Low | Pulumi ESC | ⚠️ Manual (long-lived) |

## Rationale

### Why External Secrets Operator?

1. **Separation of Concerns**
   - Secret storage separate from secret delivery
   - Can swap backends without changing application code
   - Operator pattern: k8s-native, declarative

2. **Flexibility**
   - Start simple (Pulumi ESC)
   - Add sophistication incrementally (Vault, cloud)
   - Multiple backends simultaneously
   - No vendor lock-in

3. **Pulumi Integration**
   - Native Pulumi ESC backend support (since ESO v0.10.0)
   - Deploy ESO itself via Pulumi
   - Manage ExternalSecret resources as Pulumi code
   - Fits existing IaC workflow

4. **Operational Simplicity**
   - Lightweight operator (~50MB memory)
   - No additional infrastructure to run (when using Pulumi ESC)
   - Low maintenance overhead
   - Active community (40+ supported backends)

### Why Pulumi ESC as Initial Backend?

1. **Already Using Pulumi**
   - No new tools to learn
   - Secrets already encrypted in stack files
   - Existing access controls apply
   - Version controlled via Git

2. **Low Complexity**
   - No additional services to run
   - No Vault to operate
   - No cloud dependencies (unless chosen)
   - Minimal configuration

3. **Migration Path**
   - ESO abstracts the backend
   - Later: Add Vault for dynamic secrets
   - Later: Add AWS SM for critical rotation
   - Apps unchanged during migration

### Why Not Alternatives?

**Sealed Secrets (Bitnami)**
- ❌ Only rotates encryption keys, not secret values
- ❌ Secrets in Git (even encrypted, feels risky)
- ✅ Good for GitOps (Flux/Argo), not Pulumi workflows

**SOPS (Mozilla)**
- ❌ File-based, not k8s-native
- ❌ Manual rotation only
- ❌ Poor Pulumi integration
- ✅ Good for GitOps, not IaC

**Vault Only (No ESO)**
- ❌ High operational complexity for homelab
- ❌ All secrets must move to Vault (big migration)
- ❌ Overkill for static secrets (OAuth, API keys)
- ✅ Great if learning Vault specifically

**Kubernetes Secrets + etcd Encryption**
- ❌ No automatic value rotation
- ❌ No centralized management
- ❌ Each app manages its own secrets
- ✅ Good as foundation (we still use this)

**Cloud Providers Only (AWS SM, GCP SM)**
- ❌ Not self-hosted (against homelab goals)
- ❌ Vendor lock-in
- ❌ Ongoing costs
- ✅ Excellent features, consider for hybrid approach

## Implementation

### 1. Deploy External Secrets Operator

```typescript
// infrastructure/src/core/external-secrets.ts
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export const externalSecretsOperator = new k8s.helm.v3.Chart(
  "external-secrets",
  {
    chart: "external-secrets",
    version: "0.11.0",
    namespace: "external-secrets",
    fetchOpts: {
      repo: "https://charts.external-secrets.io",
    },
    values: {
      installCRDs: true,
    },
  }
);

// Configure Pulumi ESC as backend
export const pulumiEscStore = new k8s.apiextensions.CustomResource(
  "pulumi-esc-store",
  {
    apiVersion: "external-secrets.io/v1beta1",
    kind: "ClusterSecretStore",
    metadata: {
      name: "pulumi-esc",
    },
    spec: {
      provider: {
        pulumi: {
          organization: pulumi.getOrganization(),
          project: pulumi.getProject(),
          environment: pulumi.getStack(),
          accessToken: {
            secretRef: {
              name: "pulumi-api-token",
              key: "token",
            },
          },
        },
      },
    },
  }
);
```

### 2. Update ExposedWebApp Component

```typescript
// Use ExternalSecret instead of Kubernetes Secret
if (args.oauth) {
  const oauthExternalSecret = new k8s.apiextensions.CustomResource(
    `${name}-oauth`,
    {
      apiVersion: "external-secrets.io/v1beta1",
      kind: "ExternalSecret",
      metadata: {
        name: `${name}-oauth`,
        namespace: namespace.metadata.name,
      },
      spec: {
        refreshInterval: "1h", // Sync from backend every hour
        secretStoreRef: {
          name: "pulumi-esc",
          kind: "ClusterSecretStore",
        },
        target: {
          name: `${name}-oauth`,
          creationPolicy: "Owner",
        },
        data: [
          {
            secretKey: "clientId",
            remoteRef: { key: `${name}/oauth/clientId` },
          },
          {
            secretKey: "clientSecret",
            remoteRef: { key: `${name}/oauth/clientSecret` },
          },
          {
            secretKey: "cookieSecret",
            remoteRef: { key: `${name}/oauth/cookieSecret` },
          },
        ],
      },
    }
  );
}
```

### 3. Configure Secrets in Pulumi

```bash
# Store secrets in Pulumi ESC
pulumi config set --secret blog/oauth/clientId "google-client-id"
pulumi config set --secret blog/oauth/clientSecret "google-client-secret"
pulumi config set --secret blog/oauth/cookieSecret "$(openssl rand -base64 32)"
```

ESO automatically syncs these to Kubernetes Secrets every hour.

### 4. Future: Add Vault for Rotation

```typescript
// When needed: Add Vault backend
export const vaultStore = new k8s.apiextensions.CustomResource(
  "vault-store",
  {
    apiVersion: "external-secrets.io/v1beta1",
    kind: "ClusterSecretStore",
    metadata: { name: "vault-backend" },
    spec: {
      provider: {
        vault: {
          server: "http://vault.vault.svc:8200",
          path: "secret",
          version: "v2",
          auth: {
            kubernetes: {
              mountPath: "kubernetes",
              role: "external-secrets",
            },
          },
        },
      },
    },
  }
);

// Database with rotated credentials
const dbSecret = new k8s.apiextensions.CustomResource("db-credentials", {
  apiVersion: "external-secrets.io/v1beta1",
  kind: "ExternalSecret",
  spec: {
    refreshInterval: "15m", // Vault can rotate every 15 minutes
    secretStoreRef: { name: "vault-backend" },
    target: { name: "postgres-creds" },
    data: [
      {
        secretKey: "password",
        remoteRef: { key: "database/postgres/password" },
      },
    ],
  },
});
```

## Consequences

### Positive

1. **Immediate Benefit**
   - Centralized secret management today
   - Better than scattered Kubernetes Secrets
   - Apps use ExternalSecret CRD (consistent pattern)

2. **Future-Proof**
   - Can add Vault without changing apps
   - Can add cloud providers for specific secrets
   - Multiple backends coexist

3. **Operational Simplicity**
   - No Vault to run (initially)
   - ESO is lightweight, low maintenance
   - Fits Pulumi workflow

4. **Security Improvements**
   - Secrets not hardcoded in deployment manifests
   - Centralized access control
   - Audit trail (Pulumi logs + backend logs)
   - Easier to implement rotation later

### Negative

1. **Complexity Added**
   - One more operator in cluster
   - One more CRD to understand (ExternalSecret)
   - Debugging now involves ESO logs

2. **Initial Setup Effort**
   - Deploy ESO operator
   - Migrate existing secrets
   - Update ExposedWebApp component
   - Update documentation

3. **Pulumi ESC Dependency**
   - Still no automatic rotation initially
   - Must manually rotate secrets in Pulumi config
   - Not fully self-hosted (Pulumi Cloud or S3 backend)

### Neutral

1. **Not Solving Rotation Yet**
   - Phase 1 doesn't add auto-rotation
   - Establishes pattern for when we do
   - Acceptable: Most secrets don't need frequent rotation

2. **Vault Decision Deferred**
   - Can add later if needed
   - Avoids premature complexity
   - But: If you know you need Vault, could start there

## Rotation Procedures (Phase 1: Manual)

Until Vault/cloud backends are added:

### OAuth Client Secrets (Annual)
```bash
# Generate new secret
NEW_SECRET=$(openssl rand -base64 32)

# Update in Pulumi
pulumi config set --secret blog/oauth/cookieSecret "$NEW_SECRET"
pulumi up

# ESO auto-syncs within 1 hour
# Or force: kubectl annotate externalsecret blog-oauth force-sync="$(date +%s)"
```

### Database Passwords (Quarterly)
```bash
# Update in database
psql -c "ALTER USER app PASSWORD 'new-password';"

# Update in Pulumi
pulumi config set --secret blog/db/password "new-password"
pulumi up

# Restart pods to pick up new secret
kubectl rollout restart deployment/blog -n blog
```

### API Tokens (When Compromised)
```bash
# Revoke old token in provider dashboard
# Generate new token
# Update Pulumi config
pulumi config set --secret cloudflareApiToken "new-token"
pulumi up
```

## Migration from Current State

### Step 1: Deploy ESO (Week 1)
```bash
cd infrastructure
# Add external-secrets.ts to core/
pulumi up
```

### Step 2: Migrate One App (Week 2)
```bash
# Pick simplest app (hello-world)
# Update to use ExternalSecret
# Test end-to-end
# Document learnings
```

### Step 3: Migrate All Apps (Week 3-4)
```bash
# Update ExposedWebApp component
# Redeploy all apps
# Verify secret sync working
```

### Step 4: Remove Old Secrets (Week 5)
```bash
# Clean up old Kubernetes Secrets
# Update documentation
# Celebrate 🎉
```

## Success Criteria

- [ ] ESO running in cluster (healthy)
- [ ] At least one app using ExternalSecret successfully
- [ ] Secrets syncing from Pulumi ESC to k8s within 1 hour
- [ ] Documentation updated (setup guide, rotation procedures)
- [ ] Team comfortable with `kubectl describe externalsecret` debugging

## Future Enhancements

1. **Add Vault for Dynamic Secrets** (Q2)
   - Database credential rotation
   - Service-to-service certificates
   - Learn Vault operations

2. **Add AWS Secrets Manager** (Optional)
   - For critical production secrets
   - Native rotation for RDS credentials
   - Hybrid approach (some secrets in cloud)

3. **Automated Rotation Monitoring** (Q3)
   - Alert on rotation failures
   - Dashboard showing last rotation dates
   - Automated rotation tests

4. **Secret Versioning UI** (Q4)
   - Web interface showing secret history
   - Rollback capabilities
   - Audit log visualization

## References

- [External Secrets Operator Documentation](https://external-secrets.io/)
- [Pulumi ESC Integration](https://www.pulumi.com/blog/cloud-native-secret-management-with-pulumi-esc-and-external-secrets-operator/)
- [ADR 004: Component Pattern](./004-component-pattern.md)
- [Vault Dynamic Secrets](https://developer.hashicorp.com/vault/docs/secrets/databases)
- [AWS Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)

## Notes

- This ADR focuses on **application secrets**, not infrastructure secrets (kubeconfig, Tailscale keys, etc.)
- TLS certificate rotation handled separately by cert-manager
- Cloudflare Tunnel token rotation not addressed (long-lived by design)
- Consider this a **living decision** - revisit as homelab grows
