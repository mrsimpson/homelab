# @mrsimpson/homelab-core-components

Reusable Pulumi components for deploying containerized applications.

## What Goes Here

- **ExposedWebApp** - Component for deploying HTTP/HTTPS web applications
  - Kubernetes Deployment + Service + Ingress
  - Optional TLS (via cert-manager)
  - Optional OAuth2 protection
  - Optional persistent storage
  - Security hardened by default

- **HomelabContext** - Dependency injection for infrastructure dependencies
  - Wires together CloudFlare, cert-manager, ingress, secrets
  - Provides convenient methods for app creation

## Usage

```typescript
import { ExposedWebApp, HomelabContext } from "@mrsimpson/homelab-core-components";

// ExposedWebApp component
const app = homelab.createExposedWebApp("my-app", {
  image: "nginx:latest",
  domain: "app.example.com",
  port: 8080,
  replicas: 2,
  storage: {
    size: "10Gi",
    mountPath: "/data"
  },
  oauth: {
    provider: "google",
    clientId: "...",
    clientSecret: "..."
  }
});
```

## Publishing

This package can be published to npm for reuse in external Pulumi projects.

```bash
npm publish
```
