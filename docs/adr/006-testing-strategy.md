# ADR 006: Testing Strategy for Infrastructure

**Status:** Accepted
**Date:** 2025-12-21
**Deciders:** Project maintainers

## Context

Infrastructure as Code needs testing to prevent misconfigurations and errors from reaching production. Different testing approaches offer different trade-offs between speed, coverage, and complexity.

## Decision

Use a **layered testing approach** with focus on prevention over detection:

1. **TypeScript Compilation** (Tier 0 - Free)
2. **Pulumi Preview** (Tier 1 - Essential)
3. **Policy as Code** (Tier 1 - Essential)
4. **Synthetic Monitoring** (Tier 1 - Essential)
5. **Unit Tests** (Tier 2 - As Needed)
6. **Integration Tests** (Tier 3 - Avoided)

## Rationale

### Why Layered Approach?

**Homelab ≠ Enterprise:**
- Don't need bank-grade testing rigor
- But security matters → Need policy enforcement
- Limited time/resources → Focus on high-value tests
- Fast feedback > comprehensive coverage

**Prevention over Detection:**
- Catch errors before they're committed (pre-commit hooks)
- Catch infrastructure errors before deployment (Pulumi preview)
- Catch misconfigurations before they cause issues (policy)
- Detect runtime issues quickly (monitoring)

## Testing Tiers

### Tier 0: TypeScript Compilation (Always)

**What:** Type checking via `tsc --noEmit`

**When:** Pre-commit (via lint-staged)

**Catches:**
- Type mismatches (`port: "80"` instead of `port: 80`)
- Missing required arguments
- Invalid property access
- Null/undefined issues

**Example:**
```typescript
// ❌ Caught at compile time
new ExposedWebApp("blog", {
  image: "ghost:5",
  domain: "blog.example.com",
  port: "2368"  // Type 'string' not assignable to type 'number'
});
```

**Cost:** Free (built into TypeScript)

**Value:** High (prevents entire class of errors)

---

### Tier 1: Pulumi Preview (Essential)

**What:** Dry-run of infrastructure changes

**When:**
- Pre-push (git hook)
- CI/CD on PRs
- Manual before deployment

**Catches:**
- Resource creation/modification/deletion
- Dangerous operations (replace vs update)
- Some provider errors (invalid configuration)
- Dependency issues

**Example:**
```bash
$ pulumi preview

  +- cloudflare:index:Record  blog-dns  replace  [diff: ~name]
     ^^^^^ WARNING: Will delete and recreate

Resources:
  +-1 to replace
  5 unchanged
```

**Cost:** Free (Pulumi built-in)

**Value:** High (prevents deployment errors)

**Limitations:**
- Doesn't catch runtime misconfigurations (wrong port)
- Doesn't validate credentials until deployment
- Can't test integration between services

---

### Tier 1: Policy as Code (Essential)

**What:** Automated policy validation using Pulumi CrossGuard

**When:**
- During `pulumi preview`
- During `pulumi up`

**Catches:**
- Security violations (no TLS, privileged containers)
- Best practice violations
- Compliance issues
- Custom business rules

**Example Policies:**

```typescript
// Enforce TLS on all Ingress resources
new policy.PolicyPack("homelab-security", {
  policies: [
    {
      name: "ingress-requires-tls",
      enforcementLevel: "mandatory",
      validateResource: (args, reportViolation) => {
        if (args.type === "kubernetes:networking.k8s.io/v1:Ingress") {
          if (!args.props.spec?.tls || args.props.spec.tls.length === 0) {
            reportViolation("All Ingress resources must configure TLS");
          }
        }
      }
    },
    {
      name: "no-privileged-containers",
      enforcementLevel: "mandatory",
      validateResource: (args, reportViolation) => {
        if (args.type === "kubernetes:apps/v1:Deployment") {
          const containers = args.props.spec?.template?.spec?.containers || [];
          containers.forEach(c => {
            if (c.securityContext?.privileged === true) {
              reportViolation(`Container ${c.name} cannot run as privileged`);
            }
          });
        }
      }
    },
    {
      name: "sensitive-apps-require-oauth",
      enforcementLevel: "advisory",
      validateResource: (args, reportViolation) => {
        if (args.type === "homelab:ExposedWebApp") {
          const tags = args.props.tags || [];
          if (tags.includes("sensitive") && !args.props.oauth) {
            reportViolation("Sensitive applications should use OAuth protection");
          }
        }
      }
    }
  ]
});
```

**Run:**
```bash
$ pulumi preview --policy-pack policy/

policy violation: [mandatory] homelab-security/ingress-requires-tls
  Ingress 'my-app' must configure TLS

error: preview failed
```

**Cost:** Low (write policies once, run automatically)

**Value:** High (enforces security and best practices)

---

### Tier 1: Synthetic Monitoring (Essential)

**What:** Periodic health checks of deployed services

**When:** Continuously (cron job, GitHub Actions scheduled)

**Catches:**
- Service downtime
- TLS certificate issues
- OAuth misconfiguration
- DNS problems
- Performance degradation

**Example:**

```typescript
// monitoring/health-checks.ts
import axios from "axios";

const checks = [
  {
    name: "Blog reachable",
    url: "https://blog.example.com",
    expect: { status: 200 }
  },
  {
    name: "Dashboard requires OAuth",
    url: "https://dashboard.example.com",
    expect: { status: 302, redirect: /oauth2/ }
  },
  {
    name: "API health endpoint",
    url: "https://api.example.com/health",
    expect: { status: 200, body: { healthy: true } }
  }
];

async function runChecks() {
  for (const check of checks) {
    try {
      const response = await axios.get(check.url, {
        maxRedirects: 0,
        validateStatus: () => true
      });

      if (response.status !== check.expect.status) {
        alert(`${check.name} failed: Expected ${check.expect.status}, got ${response.status}`);
      }
    } catch (error) {
      alert(`${check.name} failed: ${error.message}`);
    }
  }
}

// Run every 5 minutes
setInterval(runChecks, 5 * 60 * 1000);
```

**Cost:** Low (simple script, can run on homelab itself)

**Value:** High (detects real-world issues)

---

### Tier 2: Component Unit Tests (As Needed)

**What:** Test component logic in isolation using Pulumi testing framework

**When:** For complex components with conditional logic

**Use For:**
- ExposedWebApp (OAuth sidecar logic)
- Database (backup configuration)
- Complex components with many branches

**Example:**

```typescript
// src/components/ExposedWebApp.test.ts
import * as pulumi from "@pulumi/pulumi";
import { ExposedWebApp } from "./ExposedWebApp";

pulumi.runtime.setMocks({
  newResource: (args) => ({ id: args.name, state: args.inputs }),
  call: (args) => args.inputs
});

describe("ExposedWebApp", () => {
  it("creates deployment with correct image", async () => {
    const app = new ExposedWebApp("test", {
      image: "nginx:latest",
      domain: "test.com",
      port: 80
    });

    const resources = await pulumi.runtime.listResources();
    const deployment = resources.find(r => r.type === "kubernetes:apps/v1:Deployment");

    expect(deployment.inputs.spec.template.spec.containers[0].image).toBe("nginx:latest");
  });

  it("adds oauth sidecar when configured", async () => {
    const app = new ExposedWebApp("test", {
      image: "nginx:latest",
      domain: "test.com",
      port: 80,
      oauth: {
        provider: "google",
        clientId: "test",
        clientSecret: pulumi.secret("secret")
      }
    });

    const resources = await pulumi.runtime.listResources();
    const deployment = resources.find(r => r.type === "kubernetes:apps/v1:Deployment");

    expect(deployment.inputs.spec.template.spec.containers).toHaveLength(2);
    expect(deployment.inputs.spec.template.spec.containers[0].name).toBe("oauth-proxy");
  });

  it("creates PVC when storage configured", async () => {
    const app = new ExposedWebApp("test", {
      image: "nginx:latest",
      domain: "test.com",
      port: 80,
      storage: { size: "10Gi", mountPath: "/data" }
    });

    const resources = await pulumi.runtime.listResources();
    const pvc = resources.find(r => r.type === "kubernetes:core/v1:PersistentVolumeClaim");

    expect(pvc).toBeDefined();
    expect(pvc.inputs.spec.resources.requests.storage).toBe("10Gi");
  });
});
```

**Run:**
```bash
npm test
```

**Cost:** Medium (need to write tests, maintain as components change)

**Value:** Medium (helpful for complex logic, but not essential for simple components)

**When to skip:**
- Simple components with little logic
- Components that just compose existing resources
- Time-constrained projects

---

### Tier 3: Integration Tests (Avoid for Homelab)

**What:** Deploy to test environment and validate

**Why Avoid:**
- ❌ Requires test cluster (complexity, cost)
- ❌ Requires test domain
- ❌ Slow (minutes per test run)
- ❌ Complex teardown (state management)
- ❌ Overkill for homelab

**When to use:**
- Mission-critical production systems
- Team environments with dedicated test infrastructure
- Regulatory compliance requirements

**Verdict:** Not worth it for homelab

---

## Testing Matrix

| Error Type | TypeScript | Preview | Policy | Unit Test | Monitoring |
|------------|-----------|---------|--------|-----------|------------|
| **Type error** | ✅ | ✅ | - | - | - |
| **Missing arg** | ✅ | ✅ | - | - | - |
| **Resource changes** | - | ✅ | - | - | - |
| **Security violation** | - | - | ✅ | - | - |
| **Wrong app port** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Invalid OAuth creds** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Component logic bug** | ⚠️ | ⚠️ | - | ✅ | - |
| **DNS conflict** | ❌ | ⚠️ | ✅ | - | ✅ |
| **Missing TLS** | ❌ | ❌ | ✅ | - | ✅ |

## Implementation Plan

### Phase 1: Essential (Immediate)

1. ✅ TypeScript strict mode (done)
2. ✅ Pulumi preview in pre-push (done)
3. **TODO:** Create security policy pack
4. **TODO:** Set up basic synthetic monitoring

### Phase 2: Enhanced (When Components Complex)

5. **TODO:** Unit tests for ExposedWebApp component
6. **TODO:** CI/CD with GitHub Actions

### Phase 3: Advanced (Optional)

7. **TODO:** Advanced monitoring (Prometheus + Grafana)
8. **TODO:** Automated policy testing

## Policies to Implement

**Security:**
- All Ingress must have TLS
- No privileged containers
- No containers running as root
- Resource limits required
- Sensitive apps must use OAuth

**Best Practices:**
- No hardcoded secrets (use Pulumi config)
- All services must have labels
- Naming conventions enforced
- Storage requests must specify size

## Monitoring to Implement

**Basic Health Checks:**
- HTTP 200 for public services
- HTTP 302 (OAuth redirect) for protected services
- TLS certificate validity
- DNS resolution

**Advanced (Optional):**
- Response time tracking
- Uptime percentage
- Certificate expiration alerts

## Alternatives Considered

### Terratest (Integration Testing Framework)

**Pros:**
- Purpose-built for IaC testing
- Good integration test support

**Cons:**
- ❌ Requires Go knowledge
- ❌ Complex setup
- ❌ Requires test infrastructure
- ❌ Overkill for homelab

**Verdict:** Too heavy for homelab

### Continuous Deployment (No Testing)

**Pros:**
- Fastest iteration
- Simplest approach

**Cons:**
- ❌ Errors reach production
- ❌ Breaking changes in main branch
- ❌ Hard to rollback

**Verdict:** Too risky even for homelab

## Success Metrics

- Zero type errors in committed code
- Zero Pulumi preview failures in main branch
- Zero policy violations in deployed infrastructure
- 99%+ uptime for critical services
- < 5 minute detection time for outages (via monitoring)

## References

- [Pulumi Testing Documentation](https://www.pulumi.com/docs/using-pulumi/testing/)
- [Pulumi Policy as Code (CrossGuard)](https://www.pulumi.com/docs/using-pulumi/crossguard/)
- [Best Practices for IaC Testing](https://www.pulumi.com/docs/using-pulumi/testing/unit/)
