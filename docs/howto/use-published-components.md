# Using Published Components in App Repositories

## Quick Start

### 1. Create App Repository

```bash
mkdir my-app && cd my-app
git init
npm init -y
```

### 2. Install Components Package

```bash
npm install @mrsimpson/homelab-components
npm install @pulumi/pulumi @pulumi/kubernetes @pulumi/cloudflare
```

### 3. Create Pulumi Program

**Pulumi.yaml:**
```yaml
name: my-app
runtime: nodejs
description: My homelab application
```

**index.ts:**
```typescript
import * as pulumi from "@pulumi/pulumi";
import { ExposedWebApp } from "@mrsimpson/homelab-components";

const config = new pulumi.Config();

new ExposedWebApp("my-app", {
  image: "nginxdemos/hello:latest",
  domain: config.require("domain"),
  port: 80,
  replicas: 2
});
```

### 4. Configure and Deploy

```bash
# Login to Pulumi Cloud
# See ADR 009 for state backend details
pulumi login

# Initialize stack
pulumi stack init dev

# Set configuration (inherit from infrastructure stack)
pulumi config set domain my-app.example.com
pulumi config set cloudflareAccountId <ACCOUNT_ID>
pulumi config set cloudflareZoneId <ZONE_ID>
pulumi config set --secret cloudflareApiToken <TOKEN>

# Deploy
pulumi up
```

**Note:** We use Pulumi Cloud for state management. See [ADR 009](../adr/009-pulumi-cloud-state-backend.md) for details and migration options.

## Examples

### Static Website
```typescript
new ExposedWebApp("website", {
  image: "nginx:alpine",
  domain: "example.com",
  port: 80
});
```

### With OAuth Protection
```typescript
new ExposedWebApp("admin", {
  image: "my-admin-ui:latest",
  domain: "admin.example.com",
  port: 3000,
  oauth: {
    provider: "google",
    clientId: config.require("googleClientId"),
    clientSecret: config.requireSecret("googleClientSecret"),
    allowedEmails: ["admin@example.com"]
  }
});
```

### With Persistent Storage
```typescript
new ExposedWebApp("blog", {
  image: "ghost:5",
  domain: "blog.example.com",
  port: 2368,
  storage: {
    size: "10Gi",
    mountPath: "/var/lib/ghost/content"
  },
  resources: {
    requests: { cpu: "200m", memory: "512Mi" },
    limits: { cpu: "1000m", memory: "1Gi" }
  }
});
```

## GitHub Actions Deployment

**.github/workflows/deploy.yml:**
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
          node-version: '24'

      # Connect to homelab via Tailscale
      - uses: tailscale/github-action@v2
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
          oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
          tags: tag:ci

      # Build and push image
      - run: docker build -t ghcr.io/${{ github.repository }}:${{ github.sha }} .
      - run: docker push ghcr.io/${{ github.repository }}:${{ github.sha }}

      # Deploy via Pulumi
      - run: npm ci
      - run: pulumi up --yes
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_TOKEN }}
          KUBECONFIG: ${{ secrets.KUBECONFIG }}
```

## Updating Components

```bash
# Check for updates
npm outdated @mrsimpson/homelab-components

# Update to latest
npm update @mrsimpson/homelab-components

# Or pin specific version
npm install @mrsimpson/homelab-components@0.2.0
```

## Publishing New Component Versions

**In infrastructure repo:**

```bash
# Make changes to components
vim src/components/ExposedWebApp.ts

# Update version
npm version patch  # or minor, major

# Commit and tag
git add -A
git commit -m "feat: add new component feature"
git push

# Push tag (triggers GitHub Actions publish)
git push --tags
```

Version published automatically to npm.

## Troubleshooting

### Import errors
Ensure TypeScript can find types:
```bash
npm install --save-dev @types/node
```

### Version conflicts
Lock to specific version:
```json
{
  "dependencies": {
    "@mrsimpson/homelab-components": "0.1.0"
  }
}
```

### Missing peer dependencies
Install all Pulumi providers used by components:
```bash
npm install @pulumi/kubernetes @pulumi/cloudflare
```

## Component API Reference

See [ExposedWebApp component source](https://github.com/mrsimpson/homelab/blob/main/packages/core/components/src/ExposedWebApp.ts) for full API documentation.
