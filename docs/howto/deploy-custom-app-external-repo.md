# How to: Deploy a Custom App from External Repository

This guide shows you how to build, publish, and deploy a custom application to your homelab using GitHub Container Registry (GHCR) and a separate application repository.

## Overview

This workflow follows the **separate repository pattern** recommended in [ADR 007](../adr/007-separate-app-repositories.md):

```
┌─────────────────────────────────────────────────────────────────┐
│ DEVELOPMENT PHASE                                               │
├─────────────────────────────────────────────────────────────────┤
│ 1. Write app code (Node.js/Python/Go/etc.)                     │
│ 2. Create Dockerfile                                            │
│ 3. Create Pulumi deployment code                               │
└─────────────────────┬───────────────────────────────────────────┘
                      │ git push
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ CI/CD PHASE (GitHub Actions)                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Trigger on push/tag                                          │
│ 2. Build Docker image                                           │
│ 3. Scan with Trivy (vulnerability check)                        │
│ 4. Push to GHCR (ghcr.io/username/app:tag)                     │
│ 5. Sign image (optional: cosign)                               │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Manual or automatic
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ DEPLOYMENT PHASE (Pulumi)                                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. pulumi up                                                    │
│ 2. Create ImagePullSecret (GHCR token via ESO)                 │
│ 3. Deploy ExposedWebApp (references ghcr.io image)             │
│ 4. Kubernetes pulls image using ImagePullSecret                │
│ 5. Cloudflare DNS + Ingress route traffic                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ RUNNING APP                                                     │
│ https://myapp.yourdomain.com                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- ✅ Homelab infrastructure deployed
- ✅ GHCR credentials configured (see [setup-ghcr-credentials.md](./setup-ghcr-credentials.md))
- ✅ GitHub account with permissions to create repositories
- ✅ Node.js/npm installed locally (for Pulumi deployment code)

---

## Step 1: Create Your Application Repository

### 1.1 Repository Structure

Create a new GitHub repository with this structure:

```
my-custom-app/
├── .github/
│   └── workflows/
│       └── build-and-push.yml      # CI/CD workflow
├── src/
│   ├── index.js                     # Your application code
│   └── package.json                 # Application dependencies
├── deployment/
│   ├── index.ts                     # Pulumi deployment code
│   ├── Pulumi.yaml                  # Pulumi project config
│   ├── package.json                 # Deployment dependencies
│   └── tsconfig.json                # TypeScript config
├── Dockerfile                       # Container image definition
├── .dockerignore                    # Files to exclude from build
├── .gitignore
└── README.md
```

### 1.2 Create Repository on GitHub

```bash
# Option 1: Via GitHub CLI
gh repo create my-custom-app --public --clone
cd my-custom-app

# Option 2: Via web UI
# Visit https://github.com/new and create the repository
# Then clone it:
git clone https://github.com/your-username/my-custom-app.git
cd my-custom-app
```

---

## Step 2: Write Your Application Code

### 2.1 Create Application

**`src/index.js`** (Example Express.js app):

```javascript
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Basic route
app.get('/', (req, res) => {
  res.json({
    message: 'Hello from my custom app!',
    version: process.env.APP_VERSION || 'dev',
    timestamp: new Date().toISOString(),
    hostname: require('os').hostname()
  });
});

// Health check endpoint (required for Kubernetes)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Readiness probe
app.get('/ready', (req, res) => {
  // Add any startup checks here (database connection, etc.)
  res.json({ status: 'ready' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
```

**`src/package.json`**:

```json
{
  "name": "my-custom-app",
  "version": "1.0.0",
  "description": "My custom homelab application",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### 2.2 Test Locally

```bash
cd src
npm install
npm start

# In another terminal:
curl http://localhost:3000
curl http://localhost:3000/health
```

---

## Step 3: Create Dockerfile

**`Dockerfile`** (Multi-stage build for security and size):

```dockerfile
# ============================================================================
# Build Stage - Install dependencies
# ============================================================================
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files first (Docker layer caching)
COPY src/package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# ============================================================================
# Runtime Stage - Minimal production image
# ============================================================================
FROM node:24-alpine

WORKDIR /app

# Security: Create non-root user
# This is REQUIRED for Pod Security Standard "restricted"
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

# Copy dependencies from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application source code
COPY src/ ./

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user (REQUIRED for homelab)
USER appuser

# Expose application port
EXPOSE 3000

# Health check for container runtime
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["node", "index.js"]
```

**`.dockerignore`**:

```
# Node.js
node_modules
npm-debug.log
*.log

# Development
.git
.gitignore
.env
.env.*

# Deployment code
deployment/

# Documentation
README.md
*.md

# CI/CD
.github/

# Editor
.vscode
.idea
*.swp
```

### 3.1 Test Docker Build Locally

```bash
# Build the image
docker build -t my-custom-app:test .

# Run container
docker run -p 3000:3000 --name my-app-test my-custom-app:test

# Test in another terminal
curl http://localhost:3000
curl http://localhost:3000/health

# Check container runs as non-root (security verification)
docker exec my-app-test whoami
# Should output: appuser

# Clean up
docker stop my-app-test
docker rm my-app-test
```

---

## Step 4: Create GitHub Actions Workflow

**`.github/workflows/build-and-push.yml`**:

```yaml
name: Build and Push to GHCR

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]
  workflow_dispatch:  # Allow manual trigger

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write  # Required for GHCR push
      security-events: write  # Required for Trivy results upload

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix={{branch}}-
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push Docker image
        id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64  # Add linux/arm64 if needed

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.version }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Fail build on critical vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.version }}
          format: 'table'
          exit-code: '1'
          severity: 'CRITICAL'
          ignore-unfixed: true  # Only fail on fixable issues
```

### 4.1 Commit and Push

```bash
git add .
git commit -m "Add application code and CI/CD workflow"
git push origin main
```

### 4.2 Verify GitHub Actions Build

1. Go to your repository on GitHub
2. Click "Actions" tab
3. You should see the workflow running
4. Wait for it to complete successfully
5. Go to "Packages" (on your profile or repo)
6. Verify the image was pushed to GHCR

---

## Step 5: Create Deployment Code

### 5.1 Install Homelab Components Package

**`deployment/package.json`**:

```json
{
  "name": "my-custom-app-deployment",
  "version": "1.0.0",
  "description": "Pulumi deployment for my-custom-app",
  "main": "index.ts",
  "scripts": {
    "deploy": "pulumi up",
    "destroy": "pulumi destroy",
    "preview": "pulumi preview"
  },
  "dependencies": {
    "@mrsimpson/homelab-core-components": "^1.0.0",
    "@mrsimpson/homelab-config": "^1.0.0",
    "@pulumi/pulumi": "^3.137.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.7"
  }
}
```

**`deployment/tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./bin",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "bin"]
}
```

### 5.2 Create Pulumi Project

**`deployment/Pulumi.yaml`**:

```yaml
name: my-custom-app
runtime: nodejs
description: My custom homelab application deployment

# Backend configuration (uses Pulumi Cloud)
backend:
  url: https://app.pulumi.com/your-org/my-custom-app
```

### 5.3 Write Deployment Code

**`deployment/index.ts`**:

```typescript
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";

/**
 * My Custom App Deployment
 *
 * This Pulumi program deploys a custom application to the homelab
 * using the ExposedWebApp component.
 */

// TODO: Import homelab context from your base infrastructure
// This requires exporting the homelab context from your base-infra stack
// For now, we'll reference it via stack reference
const baseInfraStack = new pulumi.StackReference(
  `your-org/homelab/dev`,  // Adjust to your actual stack
);

// Get domain from homelab config
const baseDomain = homelabConfig.domain;
const appDomain = pulumi.interpolate`myapp.${baseDomain}`;

// Get image version from environment or use latest
const imageVersion = process.env.IMAGE_VERSION || "latest";
const githubUsername = "your-username";  // Replace with your GitHub username

// Deploy the application using ExposedWebApp
// Note: You'll need to import homelab context or create it here
// For this example, we'll show the full manual setup

import { ExposedWebApp } from "@mrsimpson/homelab-core-components";

const app = new ExposedWebApp("my-custom-app", {
  // Container image from GHCR
  image: `ghcr.io/${githubUsername}/my-custom-app:${imageVersion}`,

  // Domain configuration
  domain: appDomain,

  // Application port (must match EXPOSE in Dockerfile)
  port: 3000,

  // Scaling
  replicas: 2,  // High availability

  // Resource limits (adjust based on your app's needs)
  resources: {
    requests: {
      cpu: "100m",      // 0.1 CPU core
      memory: "128Mi",  // 128 MiB RAM
    },
    limits: {
      cpu: "500m",      // 0.5 CPU core max
      memory: "512Mi",  // 512 MiB RAM max
    },
  },

  // IMPORTANT: ImagePullSecret for private GHCR images
  imagePullSecrets: [{ name: "ghcr-pull-secret" }],

  // Environment variables (optional)
  env: [
    { name: "NODE_ENV", value: "production" },
    { name: "APP_VERSION", value: imageVersion },
  ],

  // Optional: OAuth protection (uncomment to enable)
  /*
  oauth: {
    provider: "github",
    clientId: "your-github-oauth-app-client-id",
    clientSecret: pulumi.output("your-client-secret-from-pulumi-esc"),
    allowedEmails: ["your-email@example.com"],
  },
  */

  // Optional: Persistent storage (uncomment if needed)
  /*
  storage: {
    size: "1Gi",
    mountPath: "/app/data",
    storageClass: "local-path",
  },
  */

  // Infrastructure dependencies (reference from base-infra stack)
  cloudflare: {
    zoneId: baseInfraStack.getOutput("cloudflareZoneId"),
    tunnelCname: baseInfraStack.getOutput("tunnelCname"),
  },
  tls: {
    clusterIssuerName: "letsencrypt-prod",
  },
  ingress: {
    className: "nginx",
  },

  // Tags for organization
  tags: ["custom", "nodejs", "production"],
});

// Export the application URL
export const url = pulumi.interpolate`https://${appDomain}`;
export const imageTag = imageVersion;
```

### 5.4 Install Dependencies

```bash
cd deployment
npm install
```

---

## Step 6: Deploy to Homelab

### 6.1 Initialize Pulumi Stack

```bash
cd deployment

# Login to Pulumi Cloud
pulumi login

# Create a new stack
pulumi stack init dev

# Configure required settings
pulumi config set cloudflare:apiToken "your-cloudflare-api-token" --secret
```

### 6.2 Deploy Application

```bash
# Preview changes
pulumi preview

# Deploy to homelab
pulumi up

# Type 'yes' when prompted
```

You should see output like:

```
Updating (dev)

View Live: https://app.pulumi.com/...

     Type                              Name                    Status
 +   pulumi:pulumi:Stack               my-custom-app-dev       created
 +   └─ homelab:ExposedWebApp          my-custom-app           created
 +      ├─ kubernetes:core/v1:Namespace        my-custom-app-ns        created
 +      ├─ kubernetes:apps/v1:Deployment       my-custom-app-deployment created
 +      ├─ kubernetes:core/v1:Service          my-custom-app-service   created
 +      ├─ kubernetes:networking.k8s.io/v1:Ingress my-custom-app-ingress created
 +      └─ cloudflare:index:Record      my-custom-app-dns       created

Outputs:
    url: "https://myapp.yourdomain.com"

Resources:
    + 6 created

Duration: 45s
```

### 6.3 Verify Deployment

```bash
# Check pod status
kubectl get pods -n my-custom-app

# Expected output:
# NAME                            READY   STATUS    RESTARTS   AGE
# my-custom-app-xxxxxxxxx-xxxxx   1/1     Running   0          30s
# my-custom-app-xxxxxxxxx-xxxxx   1/1     Running   0          30s

# Check service
kubectl get svc -n my-custom-app

# Check ingress
kubectl get ingress -n my-custom-app

# View pod logs
kubectl logs -n my-custom-app -l app=my-custom-app --tail=50
```

---

## Step 7: Access Your Application

### 7.1 Wait for DNS Propagation

```bash
# Check DNS resolution
dig myapp.yourdomain.com

# Should point to Cloudflare Tunnel CNAME
```

### 7.2 Test Application

```bash
# Visit in browser
open https://myapp.yourdomain.com

# Or via curl
curl https://myapp.yourdomain.com
curl https://myapp.yourdomain.com/health
```

---

## Step 8: Update Your Application

### 8.1 Make Code Changes

```bash
# Edit your application code
vim src/index.js

# Commit and push
git add .
git commit -m "Add new feature"
git push origin main
```

### 8.2 GitHub Actions Builds New Image

- GitHub Actions automatically builds and pushes new image with `latest` tag
- Also creates a tag with git SHA: `main-abc1234`

### 8.3 Update Deployment

```bash
cd deployment

# Option 1: Force pod restart (pulls latest image)
kubectl rollout restart deployment my-custom-app -n my-custom-app

# Option 2: Update Pulumi with new image version
IMAGE_VERSION=main-abc1234 pulumi up

# Option 3: Use versioned releases (recommended)
# Tag your code: git tag v1.1.0 && git push --tags
# Then deploy: IMAGE_VERSION=v1.1.0 pulumi up
```

---

## Troubleshooting

### Image Pull Errors

```bash
# Check pod events
kubectl describe pod <pod-name> -n my-custom-app

# Common issues:
# 1. ImagePullBackOff - Check imagePullSecrets configuration
# 2. ErrImagePull - Verify image exists on GHCR
# 3. Unauthorized - Check GHCR credentials in Pulumi ESC
```

**Fix:**

```bash
# Verify secret exists
kubectl get secret ghcr-pull-secret -n default

# Check ExternalSecret status
kubectl get externalsecret -n default

# Recreate secret if needed
kubectl delete secret ghcr-pull-secret -n default
# ESO will recreate automatically
```

### Pod CrashLoopBackOff

```bash
# Check logs
kubectl logs -n my-custom-app <pod-name>

# Common causes:
# 1. Application error on startup
# 2. Missing environment variables
# 3. Port mismatch (Dockerfile EXPOSE vs ExposedWebApp port)
```

### Certificate Issues

```bash
# Check cert-manager certificate
kubectl get certificate -n my-custom-app

# Check certificate issuance
kubectl describe certificate my-custom-app-tls -n my-custom-app
```

### DNS Not Resolving

```bash
# Verify Cloudflare DNS record created
pulumi stack output

# Check Cloudflare dashboard
# Ensure record is proxied (orange cloud)
```

---

## Best Practices

### Security

✅ **Always run as non-root user** (UID 1000 in Dockerfile)
✅ **Set resource limits** to prevent resource exhaustion
✅ **Scan images with Trivy** before deployment
✅ **Use semantic versioning** for image tags (not just `latest`)
✅ **Rotate GHCR tokens** every 90 days
✅ **Add OAuth protection** for internal apps

### Reliability

✅ **Run 2+ replicas** for high availability
✅ **Add health check endpoints** (`/health`, `/ready`)
✅ **Implement graceful shutdown** (handle SIGTERM)
✅ **Set appropriate resource requests** for scheduling
✅ **Use readiness probes** to avoid routing to unhealthy pods

### Operations

✅ **Use versioned image tags** for rollback capability
✅ **Export metrics** (Prometheus format) for observability
✅ **Structure logs as JSON** for parsing
✅ **Add labels/tags** for organization
✅ **Document environment variables** in README

---

## Next Steps

- [ ] Add Prometheus metrics endpoint
- [ ] Set up log aggregation (Loki)
- [ ] Configure alerts (AlertManager)
- [ ] Add OAuth protection
- [ ] Set up automated Pulumi deployments via GitHub Actions
- [ ] Implement blue-green deployments
- [ ] Add integration tests

## References

- [ADR 007: Separate Application Repositories](../adr/007-separate-app-repositories.md)
- [Setup GHCR Credentials](./setup-ghcr-credentials.md)
- [ExposedWebApp Component Documentation](../../packages/core/components/src/ExposedWebApp.ts)
- [GitHub Container Registry Docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Pulumi Kubernetes Guide](https://www.pulumi.com/docs/clouds/kubernetes/)
