# Homelab Policy Pack

Security and best practices policies for homelab infrastructure using Pulumi CrossGuard.

## Overview

This policy pack enforces:
- **Security** - TLS, non-root containers, resource limits
- **Authentication** - OAuth requirements for sensitive services
- **Best Practices** - Naming conventions, labeling, no :latest tags
- **Homelab-specific** - Cloudflare Tunnel, cert-manager integration

## Policy Tiers

### Tier 1: Security (Mandatory) 🔒

**Violations block deployment**

- `ingress-requires-tls` - All Ingress must have TLS configured
- `no-privileged-containers` - No containers in privileged mode
- `containers-must-run-as-non-root` - Containers must set runAsNonRoot: true
- `no-host-network` - Pods cannot use host network
- `no-host-pid-ipc` - Pods cannot share host PID/IPC namespaces
- `resource-limits-required` - Containers must specify CPU/memory limits
- `oauth-requires-valid-provider` - OAuth must use supported providers
- `pvc-must-specify-size` - PVCs must specify storage size
- `no-hardcoded-secrets` - No secrets in plain text

### Tier 2: Authentication (Conditional) 🔐

**Enforced based on service tags**

- `sensitive-services-require-oauth` - Services tagged `sensitive` must have OAuth
- `public-services-must-be-explicit` - Public services must be tagged `public`

### Tier 3: Best Practices (Advisory) ⚠️

**Warnings, but don't block deployment**

- `ingress-must-target-tunnel` - Ingress should point to Cloudflare Tunnel
- `pvc-uses-valid-storage-class` - PVCs should use approved storage classes
- `deployments-require-labels` - Deployments should have standard labels
- `services-must-match-deployment-selector` - Services should have selectors
- `no-latest-image-tag` - Don't use :latest, use specific versions
- `naming-convention` - Follow lowercase-hyphenated naming
- `cert-manager-cluster-issuer` - Use cert-manager for TLS
- `resource-namespace` - Don't deploy to system namespaces

## Usage

### Install Dependencies

```bash
cd policy
npm install
```

### Run with Pulumi

```bash
# Preview with policy checks
cd ../  # Back to infrastructure/
pulumi preview --policy-pack policy/

# Deploy with policy enforcement
pulumi up --policy-pack policy/
```

### Example Output

**Successful validation:**
```
Previewing update (dev):

  + 6 resources to create

Policy Packs run:
  homelab-policies (local: policy)
    - All policies passed

Resources:
  + 6 to create
```

**Policy violations:**
```
Previewing update (dev):

  + 6 resources to create

Policy Packs run:
  homelab-policies (local: policy)
    ❌ ingress-requires-tls (mandatory)
       Ingress 'my-app' must configure TLS

    ⚠️  no-latest-image-tag (advisory)
       Container 'app' uses ':latest' tag

error: preview failed: mandatory policy violation
```

## Policy Examples

### Mark Service as Sensitive

```typescript
// Requires OAuth
new ExposedWebApp("admin-panel", {
  image: "admin:1.0.0",
  domain: "admin.example.com",
  port: 8080,
  tags: ["sensitive"],  // ← Triggers oauth requirement
  oauth: {
    provider: "google",
    clientId: config.require("adminOAuthClientId"),
    clientSecret: config.requireSecret("adminOAuthSecret")
  }
});
```

### Mark Service as Public

```typescript
// Explicitly public (no OAuth)
new ExposedWebApp("blog", {
  image: "ghost:5.80",
  domain: "blog.example.com",
  port: 2368,
  tags: ["public"]  // ← Acknowledges public access
});
```

### Proper Resource Limits

```typescript
new ExposedWebApp("api", {
  image: "api:2.1.0",
  domain: "api.example.com",
  port: 3000,
  resources: {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" }  // ← Required by policy
  }
});
```

## Customizing Policies

### Change Enforcement Level

```typescript
{
  name: "no-latest-image-tag",
  enforcementLevel: "mandatory",  // Change from "advisory"
  // ...
}
```

Levels:
- `mandatory` - Blocks deployment
- `advisory` - Warns but allows
- `disabled` - Policy not checked

### Add Custom Policy

```typescript
{
  name: "custom-label-required",
  description: "All resources must have 'team' label",
  enforcementLevel: "mandatory",
  validateResource: (args, reportViolation) => {
    const labels = args.props.metadata?.labels || {};
    if (!labels.team) {
      reportViolation(`Resource '${args.name}' must have 'team' label`);
    }
  }
}
```

### Modify Approved Storage Classes

```typescript
{
  name: "pvc-uses-valid-storage-class",
  // ...
  validateResource: policy.validateResourceOfType(
    "kubernetes:core/v1:PersistentVolumeClaim",
    (pvc, args, reportViolation) => {
      const validStorageClasses = [
        "nfs",
        "synology-nfs",
        "local-path",
        "your-custom-class"  // ← Add your storage class
      ];
      // ...
    }
  )
}
```

## Testing Policies

### Test with Example Resources

```bash
# Create test deployment with violations
cat > test-deployment.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  template:
    spec:
      containers:
      - name: app
        image: nginx:latest  # ← Violation: :latest tag
        # Missing: resource limits  # ← Violation
EOF

# Convert to Pulumi and test
pulumi preview --policy-pack policy/
```

### Disable Specific Policy

```bash
# Skip a specific policy check
pulumi preview --policy-pack policy/ \
  --policy-pack-config '{"disabled":["no-latest-image-tag"]}'
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/policy-check.yml
name: Policy Check
on: [pull_request]
jobs:
  policy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Install dependencies
        run: |
          cd infrastructure
          npm install
          cd policy && npm install
      - name: Run policy checks
        run: |
          cd infrastructure
          pulumi preview --policy-pack policy/
```

## Troubleshooting

### Policy Pack Not Found

```bash
# Ensure policy dependencies are installed
cd policy
npm install

# Verify policy pack location
ls -la index.ts package.json
```

### Policy Not Running

```bash
# Verify policy pack syntax
cd policy
npm run build  # If using TypeScript compilation

# Run with verbose output
pulumi preview --policy-pack policy/ --logtostderr -v=9
```

### False Positives

If a policy incorrectly flags valid resources:
1. Check policy logic in `index.ts`
2. Adjust validation conditions
3. Or change enforcement level to `advisory`

## References

- [Pulumi Policy as Code (CrossGuard)](https://www.pulumi.com/docs/using-pulumi/crossguard/)
- [Policy Pack Examples](https://github.com/pulumi/examples/tree/master/policy-packs)
- [ADR 006: Testing Strategy](../../docs/adr/006-testing-strategy.md)
