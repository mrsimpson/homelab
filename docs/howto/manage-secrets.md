# Managing Secrets with External Secrets Operator

This guide shows how to configure and manage application secrets using External Secrets Operator (ESO) with Pulumi ESC backend.

## Architecture

```
Pulumi Config (encrypted)
    ↓
External Secrets Operator
    ↓
Kubernetes Secrets (synced every hour)
    ↓
Application Pods
```

**Key Benefit:** Centralized secret management with automatic sync to Kubernetes.

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

### Pattern: Hierarchical Keys

Secrets are stored with hierarchical keys:
```
{app-name}/{category}/{secret-name}
```

**Examples:**
- `blog/oauth/clientId`
- `blog/oauth/clientSecret`
- `blog/oauth/cookieSecret`
- `database/postgres/password`
- `api/stripe/apiKey`

### Set Secrets via Pulumi Config

```bash
# OAuth secrets for blog app
pulumi config set blog/oauth/clientId "123456789.apps.googleusercontent.com"
pulumi config set --secret blog/oauth/clientSecret "GOCSPX-abc123..."
pulumi config set --secret blog/oauth/cookieSecret "$(openssl rand -base64 32)"

# Database password
pulumi config set --secret database/postgres/password "$(openssl rand -base64 32)"

# API keys
pulumi config set --secret api/stripe/apiKey "sk_live_..."
```

**Important:** Always use `--secret` flag for sensitive values. This encrypts them in the stack file.

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

**Note:** With ESO, OAuth secrets are pulled from Pulumi config automatically using the pattern `{app-name}/oauth/*`. The `clientSecret` parameter is ignored but required by TypeScript interface.

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

1. **Update in Pulumi Config**
   ```bash
   NEW_SECRET=$(openssl rand -base64 32)
   pulumi config set --secret blog/oauth/cookieSecret "$NEW_SECRET"
   pulumi up
   ```

2. **Wait for ESO Sync (up to 1 hour) or force sync**
   ```bash
   kubectl annotate externalsecret blog-oauth force-sync="$(date +%s)" -n blog
   ```

3. **Restart Application Pods**
   ```bash
   kubectl rollout restart deployment/blog -n blog
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

## Reference

- [ADR 008: Secrets Management](../adr/008-secrets-management.md)
- [External Secrets Operator Docs](https://external-secrets.io)
- [Pulumi ESC Documentation](https://www.pulumi.com/docs/esc/)
