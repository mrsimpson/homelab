# How to: Set Up GitHub Container Registry (GHCR) Credentials

This guide walks you through setting up authentication for pulling private images from GitHub Container Registry (ghcr.io).

## Overview

To pull private container images from GHCR, you need to:

1. Create a GitHub Personal Access Token (PAT)
2. Store the credentials in Pulumi ESC
3. Deploy the infrastructure (already configured)
4. Use the `imagePullSecrets` in your apps

## Prerequisites

- GitHub account
- Access to your Pulumi Cloud organization
- Homelab infrastructure deployed with External Secrets Operator

---

## Step 1: Create GitHub Personal Access Token

### Via GitHub Web UI

1. **Go to GitHub Settings**
   - Visit https://github.com/settings/tokens
   - Or: Click your profile → Settings → Developer settings → Personal access tokens → Tokens (classic)

2. **Generate new token (classic)**
   - Click "Generate new token (classic)"
   - Give it a descriptive name: `homelab-ghcr-pull`
   - Set expiration: 90 days (or custom - you'll rotate this via Pulumi ESC)

3. **Select scopes**
   - ✅ Check **only** `read:packages` (Download packages from GitHub Package Registry)
   - Do NOT grant additional scopes (principle of least privilege)

4. **Generate and copy token**
   - Click "Generate token"
   - **IMPORTANT:** Copy the token immediately (starts with `ghp_`)
   - You won't be able to see it again!

### Via GitHub CLI (alternative)

```bash
# Create a token with read:packages scope
gh auth token

# Or create a new token with specific scopes
gh auth login --scopes read:packages
```

---

## Step 2: Store Credentials in Pulumi ESC

You have two options: Pulumi CLI or Pulumi Cloud UI.

### Option A: Using Pulumi CLI (Recommended)

```bash
# Navigate to your homelab directory
cd ~/homelab

# Get your current stack name
pulumi stack

# Set GitHub username (plaintext, not a secret)
pulumi config set github-credentials.username "your-github-username"

# Set GitHub token (encrypted as secret)
pulumi config set --secret github-credentials.token "ghp_your_token_here"

# Verify configuration
pulumi config
```

You should see output like:
```
KEY                              VALUE
github-credentials.username      your-github-username
github-credentials.token         [secret]
```

### Option B: Using Pulumi Cloud Web UI

1. **Open Pulumi Cloud**
   - Visit https://app.pulumi.com
   - Navigate to your organization → project → stack

2. **Go to Configuration**
   - Click "Settings" tab
   - Select "Configuration" from sidebar

3. **Add Configuration Values**

   **Add username (plaintext):**
   - Key: `github-credentials:username`
   - Value: `your-github-username`
   - Type: String
   - Secret: No

   **Add token (secret):**
   - Key: `github-credentials:token`
   - Value: `ghp_your_token_here`
   - Type: String
   - Secret: **Yes** ✅

4. **Save changes**

---

## Step 3: Deploy the Infrastructure

The GHCR pull secret is automatically created when you deploy base infrastructure:

```bash
cd ~/homelab

# Deploy or update infrastructure
pulumi up

# You should see:
# + Creating ExternalSecret "ghcr-pull-secret" in namespace "default"
```

### Verify Deployment

```bash
# Check that the ExternalSecret was created
kubectl get externalsecret -n default

# Expected output:
# NAME               STORE         REFRESH INTERVAL   STATUS
# ghcr-pull-secret   pulumi-esc    1h                 SecretSynced

# Verify the actual Secret was created
kubectl get secret ghcr-pull-secret -n default

# Check the secret contents (base64 encoded)
kubectl get secret ghcr-pull-secret -n default -o yaml
```

You should see a secret of type `kubernetes.io/dockerconfigjson` with a `.dockerconfigjson` data field.

---

## Step 4: Use in Your Applications

### In Pulumi Deployment Code

When deploying apps with private GHCR images:

```typescript
import { homelab } from "@mrsimpson/homelab-base-infra";

const app = homelab.createExposedWebApp("my-app", {
  // Private GHCR image
  image: "ghcr.io/your-username/my-app:latest",
  domain: "myapp.example.com",
  port: 3000,

  // Add ImagePullSecret for authentication
  imagePullSecrets: [{ name: "ghcr-pull-secret" }],

  // ... other config
});
```

### Troubleshooting Image Pull Failures

If pods fail to pull images:

```bash
# Check pod status
kubectl get pods -n my-app

# If you see "ImagePullBackOff" or "ErrImagePull":
kubectl describe pod <pod-name> -n my-app

# Check for authentication errors in events:
# Events:
#   Type     Reason     Message
#   ----     ------     -------
#   Warning  Failed     Failed to pull image "ghcr.io/...": unauthorized
```

**Common fixes:**

1. **Verify ExternalSecret is synced:**
   ```bash
   kubectl get externalsecret -n default
   # Status should be "SecretSynced"
   ```

2. **Check Pulumi ESC credentials:**
   ```bash
   pulumi config
   # Ensure github-credentials.token shows [secret]
   ```

3. **Verify GitHub token has correct scope:**
   - Token must have `read:packages` scope
   - Token must not be expired

4. **Manually test credentials:**
   ```bash
   # Get the stored username and token from Kubernetes
   kubectl get secret ghcr-pull-secret -n default -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq

   # Test login with Docker
   echo "ghp_your_token" | docker login ghcr.io -u your-username --password-stdin
   docker pull ghcr.io/your-username/my-app:latest
   ```

---

## Step 5: Token Rotation (Security Best Practice)

GitHub tokens should be rotated periodically (every 90 days recommended).

### Rotation Process

1. **Create new token** (follow Step 1 again with new expiration)

2. **Update Pulumi config:**
   ```bash
   pulumi config set --secret github-credentials.token "ghp_new_token_here"
   pulumi up
   ```

3. **Verify update:**
   ```bash
   # External Secrets Operator will automatically sync within 1 hour
   # To force immediate sync, delete the secret:
   kubectl delete secret ghcr-pull-secret -n default

   # ESO will recreate it immediately with new credentials
   kubectl get secret ghcr-pull-secret -n default
   ```

4. **Revoke old token** on GitHub after verifying new one works

### Automated Rotation (Future Enhancement)

For production use, consider:
- HashiCorp Vault with dynamic credentials
- AWS Secrets Manager with rotation Lambda
- GitHub Apps with automatic token refresh

See [ADR 008: Secrets Management](../adr/008-secrets-management.md) for migration path.

---

## Multiple Namespaces

If you deploy apps in multiple namespaces, update the base infrastructure:

```typescript
// In packages/stacks/base-infra/src/index.ts
const ghcrPullSecret = coreInfra.createGhcrPullSecret({
  externalSecretsOperator: coreInfra.externalSecretsOperator,
  namespaces: ["default", "my-app", "another-app"],
});
```

Or create namespace-specific secrets as needed.

---

## Alternative: Public Images

If you're just learning and don't need private images:

1. **Make your GHCR packages public:**
   - Go to https://github.com/users/your-username/packages
   - Click on your package
   - Settings → Danger Zone → Change visibility → Public

2. **Remove `imagePullSecrets`** from your app deployment

3. **No authentication needed** - Kubernetes pulls anonymously

---

## Summary

✅ Created GitHub PAT with `read:packages` scope
✅ Stored credentials in Pulumi ESC (username + token)
✅ Deployed infrastructure with GHCR pull secret
✅ Added `imagePullSecrets` to ExposedWebApp deployments
✅ Verified images pull successfully

## Next Steps

- [Deploy a custom app from external repo](./deploy-custom-app-external-repo.md)
- [Build and push images to GHCR](./build-and-push-to-ghcr.md)
- [Set up image scanning with Trivy](./setup-image-scanning.md)

## References

- [GitHub Packages Documentation](https://docs.github.com/en/packages)
- [Kubernetes ImagePullSecrets](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/)
- [External Secrets Operator](https://external-secrets.io/)
- [ADR 008: Secrets Management](../adr/008-secrets-management.md)
