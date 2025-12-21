# ADR 004: Component-Based Infrastructure Pattern

**Status:** Accepted
**Date:** 2025-12-21
**Deciders:** Project maintainers

## Context

Managing Kubernetes resources directly (Deployments, Services, Ingress, PVCs, etc.) leads to:
- Duplication across similar services
- Error-prone configuration
- Difficulty maintaining consistency
- Hard to understand intent from raw manifests

## Decision

Use **Pulumi ComponentResource pattern** to create reusable infrastructure abstractions.

## Rationale

### The Problem

Deploying a simple web app requires ~5 Kubernetes resources:

```typescript
// Without components: verbose and error-prone
const deployment = new k8s.apps.v1.Deployment(...);
const service = new k8s.core.v1.Service(...);
const ingress = new k8s.networking.v1.Ingress(...);
const pvc = new k8s.core.v1.PersistentVolumeClaim(...);
const dnsRecord = new cloudflare.Record(...);
// + more boilerplate
```

This gets copied/pasted for each app, with subtle variations and bugs.

### The Solution

Create a **ComponentResource** that encapsulates the pattern:

```typescript
// With components: intent-driven and concise
new ExposedWebApp("blog", {
  image: "ghost:latest",
  domain: "blog.example.com",
  port: 2368,
  storage: { size: "10Gi", mountPath: "/data" }
});
```

The component handles all complexity internally.

## Component Design

### ComponentResource

Pulumi's `ComponentResource` is a container for multiple resources:

```typescript
class ExposedWebApp extends pulumi.ComponentResource {
  constructor(name: string, args: ExposedWebAppArgs, opts?: pulumi.ComponentResourceOptions) {
    super("homelab:ExposedWebApp", name, {}, opts);

    // Create child resources
    const deployment = new k8s.apps.v1.Deployment(..., { parent: this });
    const service = new k8s.core.v1.Service(..., { parent: this });
    const ingress = new k8s.networking.v1.Ingress(..., { parent: this });

    // Register outputs
    this.registerOutputs({ deployment, service, ingress });
  }
}
```

### Benefits

**Encapsulation:**
- Complex logic hidden inside component
- Users only see simple interface
- Implementation can change without breaking users

**Type Safety:**
- TypeScript interfaces for component args
- IDE autocomplete and validation
- Impossible to pass invalid configuration

**Reusability:**
- Define pattern once, use everywhere
- Consistent behavior across all instances
- Easier to update (fix component, all instances benefit)

**Composability:**
- Components can use other components
- Build higher-level abstractions
- Example: `BlogStack` uses `ExposedWebApp` + `Database`

**Testability:**
- Can write unit tests for component logic
- Mock child resources for testing
- Validate resource creation

## Core Components

### ExposedWebApp

**Purpose:** Web application exposed to internet via Cloudflare Tunnel

**Args:**
- Required: `image`, `domain`, `port`
- Optional: `oauth` (OAuth2 protection), `storage` (persistent data), `resources` (CPU/memory limits)

**Creates:**
- Deployment (k8s)
- Service (k8s)
- Ingress (k8s)
- PersistentVolumeClaim (k8s, if storage specified)
- DNS Record (Cloudflare)
- Tunnel Route (Cloudflare)
- OAuth2 Proxy sidecar (if oauth specified)

**Example:**
```typescript
new ExposedWebApp("grafana", {
  image: "grafana/grafana:latest",
  domain: "grafana.example.com",
  port: 3000,
  oauth: { provider: "google", clientId: "...", clientSecret: "..." },
  storage: { size: "5Gi", mountPath: "/var/lib/grafana" }
});
```

### Database (Future)

**Purpose:** Stateful database with persistent storage

**Args:**
- Required: `type` (postgres, mysql, mongodb), `name`
- Optional: `storage` (size), `backup` (backup schedule)

**Creates:**
- StatefulSet (k8s)
- Service (k8s)
- PersistentVolumeClaim (k8s)
- Secret (k8s, for credentials)

### CronJob (Future)

**Purpose:** Scheduled tasks

**Args:**
- Required: `image`, `schedule` (cron format), `command`
- Optional: `storage`, `env`

**Creates:**
- CronJob (k8s)
- ConfigMap (k8s, for scripts)

## Design Principles

### 1. Sensible Defaults

Components should work with minimal configuration:

```typescript
// Minimal config - uses all defaults
new ExposedWebApp("app", {
  image: "nginx:latest",
  domain: "app.example.com",
  port: 80
});
```

Defaults:
- No OAuth (public)
- No storage (stateless)
- Reasonable resource limits
- Security context (non-root)

### 2. Progressive Disclosure

Complex features are opt-in:

```typescript
// Add OAuth when needed
new ExposedWebApp("app", {
  image: "nginx:latest",
  domain: "app.example.com",
  port: 80,
  oauth: { ... }  // Only specify when needed
});
```

### 3. Type-Safe Configuration

TypeScript interfaces enforce correctness:

```typescript
export interface ExposedWebAppArgs {
  image: string;
  domain: string;
  port: number;
  oauth?: {
    provider: "google" | "github" | "oidc";  // Enum prevents typos
    clientId: string;
    clientSecret: pulumi.Input<string>;
  };
  storage?: {
    size: string;
    mountPath: string;
  };
}
```

### 4. Outputs for Composition

Components export useful outputs:

```typescript
class ExposedWebApp extends pulumi.ComponentResource {
  public readonly url: pulumi.Output<string>;
  public readonly deployment: k8s.apps.v1.Deployment;

  constructor(...) {
    // ...
    this.url = pulumi.interpolate`https://${args.domain}`;
    this.registerOutputs({ url: this.url, deployment });
  }
}

// Use outputs
const app = new ExposedWebApp(...);
export const appUrl = app.url;  // Can reference in other components
```

## OAuth Sidecar Pattern

One of the key patterns implemented in `ExposedWebApp`:

```typescript
// Conditionally add OAuth proxy sidecar
const containers = [
  { name: "app", image: args.image, ports: [{ containerPort: args.port }] }
];

if (args.oauth) {
  containers.unshift({  // Add as first container
    name: "oauth-proxy",
    image: "oauth2-proxy:v7.5.0",
    args: [
      `--upstream=http://localhost:${args.port}`,  // Proxy to app
      "--http-address=0.0.0.0:4180",
      `--provider=${args.oauth.provider}`,
      // ... more OAuth config
    ],
    ports: [{ containerPort: 4180 }]
  });
}

// Service routes to OAuth port if enabled, otherwise app port
const targetPort = args.oauth ? 4180 : args.port;
```

**Why sidecar?**
- App and OAuth proxy share network namespace (localhost communication)
- App never directly exposed (even within cluster)
- Clean separation of concerns
- Works with any web app (no app changes needed)

## Testing Components

Components should be testable:

```typescript
// Example unit test
import { ExposedWebApp } from "./ExposedWebApp";

test("ExposedWebApp creates required resources", async () => {
  const app = new ExposedWebApp("test-app", {
    image: "nginx:latest",
    domain: "test.example.com",
    port: 80
  });

  // Assert resources were created
  // (Pulumi has testing framework for this)
});
```

## Evolution Path

### Phase 1: Essential Components (Current)
- `ExposedWebApp` - Web apps with optional OAuth and storage

### Phase 2: More Components
- `Database` - Stateful databases
- `CronJob` - Scheduled tasks
- `StatefulService` - Generic stateful workloads

### Phase 3: Advanced Components
- `BlogStack` - Complete blog (app + database + backup)
- `MonitoringStack` - Prometheus + Grafana + Loki
- `DatabaseCluster` - Multi-replica database with replication

### Phase 4: Custom Operators (Future)
Convert components to Kubernetes Custom Resources:
- Define CRDs for homelab patterns
- Build operators to reconcile them
- Keep Pulumi components as alternative interface

## Documentation

Components should be documented via:

1. **TypeScript interfaces** - Clear arg types
2. **JSDoc comments** - Explain each arg
3. **Example code** - Show common usage
4. **Howto guides** - Task-oriented documentation

Example:
```typescript
/**
 * Exposes a web application to the internet via Cloudflare Tunnel.
 *
 * @example
 * ```typescript
 * new ExposedWebApp("blog", {
 *   image: "ghost:latest",
 *   domain: "blog.example.com",
 *   port: 2368,
 *   storage: { size: "10Gi", mountPath: "/var/lib/ghost" }
 * });
 * ```
 */
export class ExposedWebApp extends pulumi.ComponentResource {
  // ...
}
```

## References

- [Pulumi ComponentResource](https://www.pulumi.com/docs/concepts/resources/components/)
- [Pulumi Best Practices](https://www.pulumi.com/docs/using-pulumi/best-practices/)
- [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
