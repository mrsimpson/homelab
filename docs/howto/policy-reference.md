# Policy Reference

Quick reference for all Pulumi policies enforced in the homelab.

## Policy Summary

| Policy Name | Tier | Level | What It Checks |
|-------------|------|-------|----------------|
| `ingress-requires-tls` | Security | Mandatory | Ingress has TLS configured |
| `no-privileged-containers` | Security | Mandatory | No containers in privileged mode |
| `containers-must-run-as-non-root` | Security | Mandatory | Containers set runAsNonRoot: true |
| `no-host-network` | Security | Mandatory | Pods don't use host network |
| `no-host-pid-ipc` | Security | Mandatory | Pods don't share host PID/IPC |
| `resource-limits-required` | Security | Mandatory | Containers specify CPU/memory limits |
| `sensitive-services-require-oauth` | Auth | Mandatory | Services tagged "sensitive" have OAuth |
| `public-services-must-be-explicit` | Auth | Advisory | Public services tagged "public" |
| `oauth-requires-valid-provider` | Auth | Mandatory | OAuth uses google/github/oidc |
| `ingress-must-target-tunnel` | Network | Advisory | Ingress points to Cloudflare Tunnel |
| `pvc-must-specify-size` | Storage | Mandatory | PVCs specify storage size |
| `pvc-uses-valid-storage-class` | Storage | Advisory | PVCs use approved storage classes |
| `deployments-require-labels` | Best Practice | Advisory | Deployments have app/environment labels |
| `services-must-match-deployment-selector` | Best Practice | Advisory | Services have selectors |
| `no-latest-image-tag` | Best Practice | Advisory | Images use specific versions, not :latest |
| `naming-convention` | Best Practice | Advisory | Resources follow lowercase-hyphenated naming |
| `no-hardcoded-secrets` | Security | Mandatory | No secrets in plain text |
| `cert-manager-cluster-issuer` | Homelab | Advisory | Ingress uses cert-manager |
| `resource-namespace` | Homelab | Advisory | Resources in appropriate namespaces |

## Usage Examples

### Fix: Ingress requires TLS

**Error:**
```
policy violation: [mandatory] ingress-requires-tls
  Ingress 'my-app' must configure TLS
```

**Fix:**
```typescript
new k8s.networking.v1.Ingress("my-app", {
  spec: {
    tls: [{                          // ← Add this
      hosts: ["app.example.com"],
      secretName: "my-app-tls"
    }],
    rules: [...]
  }
});
```

### Fix: Container must run as non-root

**Error:**
```
policy violation: [mandatory] containers-must-run-as-non-root
  Container 'app' must set securityContext.runAsNonRoot: true
```

**Fix:**
```typescript
containers: [{
  name: "app",
  image: "nginx:1.25",
  securityContext: {
    runAsNonRoot: true,     // ← Add this
    runAsUser: 1000         // Optional: specify user ID
  }
}]
```

### Fix: Resource limits required

**Error:**
```
policy violation: [mandatory] resource-limits-required
  Container 'app' must specify resource limits
```

**Fix:**
```typescript
containers: [{
  name: "app",
  image: "nginx:1.25",
  resources: {
    requests: {
      cpu: "100m",
      memory: "128Mi"
    },
    limits: {               // ← Add this
      cpu: "500m",
      memory: "512Mi"
    }
  }
}]
```

### Fix: Sensitive service requires OAuth

**Error:**
```
policy violation: [mandatory] sensitive-services-require-oauth
  Service 'admin-panel' is tagged as sensitive and must configure OAuth
```

**Fix:**
```typescript
new ExposedWebApp("admin-panel", {
  image: "admin:1.0",
  domain: "admin.example.com",
  port: 8080,
  tags: ["sensitive"],
  oauth: {                  // ← Add OAuth config
    provider: "google",
    clientId: config.require("adminOAuthClientId"),
    clientSecret: config.requireSecret("adminOAuthSecret")
  }
});
```

### Advisory: No :latest tag

**Warning:**
```
policy violation: [advisory] no-latest-image-tag
  Container 'app' uses ':latest' tag. Use specific version.
```

**Fix:**
```typescript
// Instead of:
image: "nginx:latest"

// Use specific version:
image: "nginx:1.25.3"
```

## Running Policies

### Preview with Policies

```bash
cd infrastructure
pulumi preview --policy-pack policy/
```

### Deploy with Policies

```bash
pulumi up --policy-pack policy/
```

### Disable Specific Policy (Not Recommended)

```bash
pulumi preview --policy-pack policy/ \
  --policy-pack-config '{"disabled":["no-latest-image-tag"]}'
```

## Common Violations and Fixes

### Security Violations (Mandatory - Blocks Deployment)

1. **Missing TLS** → Add `spec.tls` to Ingress
2. **Privileged container** → Remove `securityContext.privileged: true`
3. **Running as root** → Add `securityContext.runAsNonRoot: true`
4. **No resource limits** → Add `resources.limits`
5. **Hardcoded secrets** → Use Pulumi config secrets

### Authentication Violations

1. **Sensitive without OAuth** → Add `oauth` config
2. **Public without tag** → Add `tags: ["public"]`

### Best Practice Warnings (Advisory - Allows Deployment)

1. **Using :latest** → Use specific version tag
2. **Missing labels** → Add `app` and `environment` labels
3. **Wrong storage class** → Use `nfs`, `synology-nfs`, or `local-path`
4. **Missing cert-manager annotation** → Add `cert-manager.io/cluster-issuer`

## Policy Development

See [infrastructure/policy/README.md](../../infrastructure/policy/README.md) for:
- How to add custom policies
- How to modify enforcement levels
- How to test policies
- CI/CD integration

## References

- [Policy Implementation](../../infrastructure/policy/index.ts)
- [ADR 006: Testing Strategy](../adr/006-testing-strategy.md)
- [Pulumi CrossGuard Docs](https://www.pulumi.com/docs/using-pulumi/crossguard/)
