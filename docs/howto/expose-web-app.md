# How to Expose a Web App

## Goal

Make a containerized web application accessible from the internet via HTTPS with automatic TLS certificates.

## Prerequisites

- Cluster set up (see [setup-cluster.md](setup-cluster.md))
- Container image (from Docker Hub, GHCR, or your own registry)
- Domain name you want to use (e.g., `app.yourdomain.com`)

## Steps

### 1. Create Application File

```bash
mkdir -p packages/apps/my-app/src
cd packages/apps/my-app
touch package.json tsconfig.json src/index.ts
```

Create `packages/apps/my-app/src/index.ts`:

```typescript
import { homelabConfig } from "@mrsimpson/homelab-config";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

export function createMyApp(homelab: HomelabContext) {
  const domain = "app.yourdomain.com";
  
  const app = homelab.createExposedWebApp("my-app", {
    image: "nginx:alpine",
    domain,
    port: 80
  });
  
  return { app, url: pulumi.interpolate`https://${domain}` };
}
```

### 2. Import in Root

Edit `src/index.ts`:

```typescript
// ... existing imports
import { createMyApp } from "@mrsimpson/homelab-app-my-app";

const myAppResult = createMyApp(homelab);
export const myAppUrl = myAppResult.url;
```

### 3. Deploy

```bash
cd homelab/infrastructure
pulumi up
```

Pulumi shows what will be created:

```
Previewing update (dev):
  + homelab:ExposedWebApp  my-app       create
  +  ├─ kubernetes:apps/v1:Deployment    my-app        create
  +  ├─ kubernetes:core/v1:Service        my-app        create
  +  ├─ kubernetes:networking/v1:Ingress  my-app        create
  +  ├─ cloudflare:index:Record           my-app-dns    create
  +  └─ cloudflare:index:TunnelRoute      my-app-route  create

Resources:
  + 6 to create
```

Type `yes` to deploy.

### 4. Wait for DNS Propagation

DNS changes can take 30-120 seconds to propagate.

```bash
# Check if DNS resolves
dig app.yourdomain.com

# Should show Cloudflare IP addresses
```

### 5. Verify

```bash
# Check deployment
kubectl get deployment my-app
# Should show READY 1/1

# Check ingress
kubectl get ingress my-app
# Should show HOST and ADDRESS

# Test access
curl https://app.yourdomain.com
# Should return app response
```

Visit `https://app.yourdomain.com` in browser - should see your app!

## What Gets Created

When you instantiate `ExposedWebApp`, Pulumi creates:

1. **Kubernetes Deployment**
   - Runs your container
   - Manages replicas (default: 1)
   - Restarts if crashed

2. **Kubernetes Service**
   - ClusterIP service
   - Routes traffic to deployment pods
   - Internal load balancing

3. **Kubernetes Ingress**
   - Routes HTTP(S) traffic based on hostname
   - Managed by ingress-nginx controller
   - Annotations for cert-manager

4. **TLS Certificate**
   - cert-manager requests from Let's Encrypt
   - Automatically renewed every 90 days
   - Stored in Kubernetes Secret

5. **Cloudflare DNS Record**
   - CNAME pointing to Cloudflare Tunnel endpoint
   - `app.yourdomain.com` → `tunnel-id.cfargotunnel.com`

6. **Cloudflare Tunnel Route**
   - Tells tunnel to route `app.yourdomain.com` to cluster Ingress

## Common Examples

### Static Website

```typescript
export const blog = new ExposedWebApp("blog", {
  image: "nginx:alpine",
  domain: "blog.yourdomain.com",
  port: 80
});
```

### Ghost Blog

```typescript
export const ghost = new ExposedWebApp("ghost", {
  image: "ghost:5",
  domain: "blog.yourdomain.com",
  port: 2368,
  storage: {
    size: "10Gi",
    mountPath: "/var/lib/ghost/content"
  }
});
```

### Grafana Dashboard

```typescript
export const grafana = new ExposedWebApp("grafana", {
  image: "grafana/grafana:latest",
  domain: "grafana.yourdomain.com",
  port: 3000,
  storage: {
    size: "5Gi",
    mountPath: "/var/lib/grafana"
  }
});
```

### Home Assistant

```typescript
export const homeAssistant = new ExposedWebApp("home-assistant", {
  image: "homeassistant/home-assistant:stable",
  domain: "home.yourdomain.com",
  port: 8123,
  storage: {
    size: "20Gi",
    mountPath: "/config"
  }
});
```

## Configuration Options

### Required Args

```typescript
{
  image: string;    // Container image (e.g., "nginx:latest")
  domain: string;   // Public domain (e.g., "app.example.com")
  port: number;     // Port the container listens on
}
```

### Optional Args

```typescript
{
  oauth?: {
    // See add-oauth-protection.md
  },

  storage?: {
    size: string;           // e.g., "10Gi"
    mountPath: string;      // e.g., "/data"
    storageClass?: string;  // default: "nfs"
  },

  resources?: {
    requests?: { cpu?: string; memory?: string; },
    limits?: { cpu?: string; memory?: string; }
  },

  env?: Array<{
    name: string;
    value?: string;
    valueFrom?: { secretKeyRef?: {...}, configMapKeyRef?: {...} }
  }>
}
```

## Updating an Application

### Change Image Version

```typescript
export const myApp = new ExposedWebApp("my-app", {
  image: "nginx:1.25",  // Changed from "nginx:alpine"
  domain: "app.yourdomain.com",
  port: 80
});
```

```bash
pulumi up
# Kubernetes will perform rolling update
```

### Add Storage

```typescript
export const myApp = new ExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain: "app.yourdomain.com",
  port: 80,
  storage: {
    size: "5Gi",
    mountPath: "/usr/share/nginx/html"
  }
});
```

```bash
pulumi up
# Creates PVC and mounts to pod
```

## Troubleshooting

### 502 Bad Gateway

```bash
# Check if pod is running
kubectl get pods -l app=my-app

# Check pod logs
kubectl logs deployment/my-app

# Common causes:
# - App not listening on specified port
# - App crashed (check logs)
# - Container health check failing
```

### 404 Not Found

```bash
# Check ingress
kubectl get ingress my-app

# Verify HOST matches your domain
kubectl describe ingress my-app

# Common causes:
# - Domain typo in configuration
# - Ingress controller not running
```

### Certificate Pending

```bash
# Check certificate status
kubectl get certificate

# Describe certificate for details
kubectl describe certificate my-app-tls

# Common causes:
# - DNS not propagated yet (wait 2-3 minutes)
# - Let's Encrypt rate limit
# - Cloudflare proxy blocking validation
```

### DNS Not Resolving

```bash
# Check Cloudflare dashboard
# Verify DNS record was created

# Check Pulumi state
pulumi stack output

# Manually verify:
dig app.yourdomain.com
# Should show Cloudflare IPs
```

### App Not Accessible

```bash
# Check all components:
kubectl get deployment,service,ingress,certificate

# Check Cloudflare Tunnel
kubectl logs -n cloudflare deployment/cloudflared

# Verify tunnel route in Cloudflare dashboard
```

## Next Steps

- [Add OAuth Protection](add-oauth-protection.md) - Secure your app with authentication
- [Set Up Persistent Storage](setup-persistent-storage.md) - Configure NFS for stateful apps
- [Deploy a Database](deploy-database.md) - Add a database to your app

## Removing an Application

```typescript
// Comment out or delete from src/apps/my-app.ts
// export const myApp = new ExposedWebApp(...);
```

```bash
pulumi up
# Pulumi will destroy the resources
```

Or delete the entire file and remove the import from `index.ts`.
