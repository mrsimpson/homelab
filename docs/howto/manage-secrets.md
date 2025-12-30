# Managing Secrets with External Secrets Operator

This guide shows how to configure and manage application secrets using External Secrets Operator (ESO) with Pulumi ESC environments.

## Architecture

```
Pulumi ESC Environment (mrsimpson/homelab/dev)
    ↓
External Secrets Operator ClusterSecretStore (pulumi-esc)
    ↓
Kubernetes Secrets (synced every hour)
    ↓
Application Pods
```

**Key Benefit:** Centralized secret management in Pulumi ESC with automatic sync to Kubernetes.

**Note:** This setup uses Pulumi ESC environments as the primary secret store, not Pulumi stack configuration.

## Prerequisites

```bash
# Install Pulumi CLI
curl -fsSL https://get.pulumi.com | sh

# Login to Pulumi (or use Pulumi Cloud)
pulumi login

# Set required configuration
pulumi config set pulumiOrganization <YOUR_ORG>
pulumi config set --secret pulumiAccessToken <YOUR_TOKEN>
```

## Storing Secrets

### Primary Method: Pulumi ESC Environments

Secrets are stored in Pulumi ESC environments, which are accessed by External Secrets Operator.

**Current ESC Environment:** `mrsimpson/homelab/dev`

**View Current Secrets:**
```bash
pulumi env open mrsimpson/homelab/dev
```

**Edit Secrets:**
```bash
pulumi env edit mrsimpson/homelab/dev
```

### Pattern: Flat Keys

ESC environments use flat key structure:
```
{service-type}-{identifier}
github-credentials (object with username/token)
github-username
github-token
```

**Current Secrets in ESC:**
- `github-credentials` - Object containing GitHub username and token
- `github-username` - GitHub username (for compatibility)
- `github-token` - GitHub personal access token (for compatibility)

### Legacy: Pulumi Stack Config

Some secrets may still be stored in Pulumi stack configuration:
```bash
# View all config (including secrets)
pulumi config --show-secrets

# Set new stack secrets (if needed)
pulumi config set --secret cloudflare:apiToken "your-token"
```

**Migration Note:** New secrets should be added to ESC environments, not stack config.

## Using Secrets in ExposedWebApp

### OAuth-Protected Application

```typescript
import { ExposedWebApp } from "@mrsimpson/homelab-components";

new ExposedWebApp("blog", {
  image: "ghost:5",
  domain: "blog.example.com",
  port: 2368,
  oauth: {
    provider: "google",
    clientId: "not-secret-can-be-hardcoded",
    clientSecret: pulumi.secret("unused"), // Ignored, pulled from ESO
    allowedEmails: ["admin@example.com"]
  }
});
```

**Note:** With ESO, GitHub credentials are pulled from Pulumi ESC environment automatically. OAuth secrets for applications would need to be added to the ESC environment.

### Custom Secret Configuration

For non-OAuth secrets, create an ExternalSecret directly:

```typescript
const apiKeySecret = new k8s.apiextensions.CustomResource("api-keys", {
  apiVersion: "external-secrets.io/v1beta1",
  kind: "ExternalSecret",
  metadata: {
    name: "api-keys",
    namespace: "my-app"
  },
  spec: {
    refreshInterval: "1h",
    secretStoreRef: {
      name: "pulumi-esc",
      kind: "ClusterSecretStore"
    },
    target: {
      name: "api-keys",
      creationPolicy: "Owner"
    },
    data: [
      {
        secretKey: "stripe",
        remoteRef: { key: "api/stripe/apiKey" }
      },
      {
        secretKey: "sendgrid",
        remoteRef: { key: "api/sendgrid/apiKey" }
      }
    ]
  }
});
```

## Rotating Secrets

### Rotation Workflow

1. **Update in Pulumi ESC Environment**
   ```bash
   # Edit the ESC environment
   pulumi env edit mrsimpson/homelab/dev
   
   # Or update programmatically (if needed)
   # Add new secret values to the environment
   ```

2. **Wait for ESO Sync (up to 1 hour) or force sync**
   ```bash
   kubectl annotate externalsecret ghcr-pull-secret force-sync="$(date +%s)" -n default
   ```

3. **Restart Application Pods**
   ```bash
   kubectl rollout restart deployment/your-app -n your-namespace
   ```

### Rotation Schedule

| Secret Type | Frequency | Trigger |
|-------------|-----------|---------|
| OAuth cookie secrets | Annually | Calendar |
| Database passwords | Quarterly | Calendar |
| API keys | On provider rotation | Provider notification |
| Compromised secrets | Immediately | Incident response |

## Troubleshooting

### ExternalSecret Not Syncing

```bash
# Check status
kubectl describe externalsecret blog-oauth -n blog

# Check ESO logs
kubectl logs -n external-secrets -l app.kubernetes.io/name=external-secrets

# Force sync
kubectl annotate externalsecret blog-oauth force-sync="$(date +%s)" -n blog
```

### Pod Can't Read Secret

```bash
# Verify secret exists
kubectl get secret blog-oauth -n blog

# Check secret contents
kubectl get secret blog-oauth -n blog -o yaml

# Restart pod
kubectl rollout restart deployment/blog -n blog
```

## Security Best Practices

### ✅ Do
- Use `--secret` flag for all sensitive values
- Use hierarchical naming (`app/category/name`)
- Rotate compromised secrets immediately
- Test rotation procedures

### ❌ Don't
- Hardcode secrets in code
- Commit plaintext secrets to Git
- Reuse secrets across apps
- Skip the `--secret` flag

## Backup and Restore

The homelab-config backup system now includes both Pulumi stack configuration and ESC environments.

### Creating Backups

```bash
cd homelab-config
./export-config.sh /path/to/homelab/project
```

This creates an encrypted backup containing:
- Pulumi stack configuration (including secrets)
- Pulumi ESC environments (including all secret values)
- Encrypted with SOPS/AGE for secure storage

### Restoring Backups

```bash
# Restore to a new stack
SOPS_AGE_KEY_FILE=~/.sops-backup/pulumi-homelab.age ./restore-config.sh production

# This restores:
# 1. All Pulumi stack configuration
# 2. All ESC environment contents
# 3. Both public and secret values
```

### What Gets Backed Up

**Stack Configuration:**
- `cloudflare:apiToken` (secret)
- `homelab:pulumiAccessToken` (secret)
- All other public configuration values

**ESC Environments:**
- `mrsimpson/homelab/dev` environment contents
- GitHub credentials and tokens
- All future ESC environment secrets

## Reference

- [ADR 008: Secrets Management](../adr/008-secrets-management.md)
- [External Secrets Operator Docs](https://external-secrets.io)
- [Pulumi ESC Documentation](https://www.pulumi.com/docs/esc/)
- [Homelab Config Backup Documentation](../../homelab-config/README.md)
