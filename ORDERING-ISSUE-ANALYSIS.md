# Pulumi Stack Re-Creation Ordering Issue Analysis

## Executive Summary

The cluster rebuild is failing due to a **critical resource dependency ordering problem**. The `ExternalSecret` resources are being created **before** the External Secrets Operator webhook service is fully ready and operational. This causes the Kubernetes API validation webhooks to fail when attempting to create ExternalSecret resources.

## The Problem

### Error Pattern
```
failed calling webhook "validate.externalsecret.external-secrets.io": 
failed to call webhook: Post "https://external-secrets-webhook.external-secrets.svc:443/validate-external-secrets-io-v1beta1-externalsecret?timeout=5s": 
service "external-secrets-webhook" not found
```

This error occurs for:
- `ghcr-pull-secret-default`
- `ghcr-pull-secret-hello-world`
- `ghcr-pull-secret-nodejs-demo`
- `ghcr-pull-secret-storage-validator`

### Root Cause

The issue is a **race condition between Helm chart deployment and resource creation**:

1. **External Secrets Operator Helm Chart** (v0.11.0) is deployed via `k8s.helm.v3.Chart`
2. The Helm chart `installCRDs: true` installs CRDs but does **NOT** guarantee the webhook service is ready
3. Immediately after, `ExternalSecret` resources try to be created
4. The Kubernetes API server attempts to validate these resources using the webhook
5. **The webhook service isn't fully initialized yet** (pods not running, service endpoints not ready)
6. Validation fails and resources cannot be created

## Detailed Dependency Chain

### Current (Broken) Flow

```
src/index.ts (main stack)
└── setupBaseInfra()
    └── HomelabContext created
    └── createGhcrPullSecret() called immediately
        └── Creates ExternalSecret resources with dependsOn: [externalSecretsOperator]
            ├── BUT: dependsOn only ensures Helm chart returns
            └── Does NOT ensure webhook service is ready!

External Secrets Helm Chart Deployment
├── Install CRDs ✓
├── Create ExternalSecrets namespace ✓
├── Deploy operator Pods...
│   └── [RACE CONDITION]
│       Pods starting up, webhook service not yet ready
└── Deploy webhook service...
    └── Service created but endpoints not available
```

### Why `dependsOn` Isn't Enough

The `dependsOn` parameter on the ExternalSecret resources depends on the **Helm Chart object**, which returns as soon as:
- The Helm release is created in Kubernetes
- Initial resources are submitted to the API server
- The Helm operation completes

But this does **NOT** wait for:
- Pod readiness (containers actually running)
- Service endpoint availability (pods registered in service)
- Webhook initialization (webhook listening and responding)

## Solutions

### Solution 1: Add Explicit Pod Readiness Check (RECOMMENDED)

Add a wait for the webhook service to be fully ready before creating ExternalSecrets:

```typescript
// In packages/core/infrastructure/src/external-secrets/index.ts

// After externalSecretsOperator Helm chart deployment...

// Wait for the webhook service to be ready
const webhookServiceReady = new k8s.core.v1.ServiceList(
  "external-secrets-webhook-ready",
  {
    metadata: {
      namespace: "external-secrets",
      fieldSelector: {
        matchingFields: {
          "metadata.name": "external-secrets-webhook",
        },
      },
    },
  },
  { dependsOn: [externalSecretsOperator] }
);

// Export this for dependencies
export const webhookReadiness = webhookServiceReady;
```

Then update `createGhcrPullSecret()` to depend on webhook readiness:

```typescript
export function createGhcrPullSecret(
  args: RegistrySecretsArgs & { webhookReady: pulumi.Resource }
) {
  // ... existing code ...
  
  const externalSecrets = namespaces.map(
    (ns) =>
      new k8s.apiextensions.CustomResource(
        `ghcr-pull-secret-${ns}`,
        { /* ... */ },
        { 
          dependsOn: [
            args.externalSecretsOperator,
            args.webhookReady  // Add explicit webhook readiness dependency
          ] 
        },
      ),
  );
}
```

### Solution 2: Wait for External Secrets Webhook Deployment

Create a Deployment waiter that ensures the webhook pods are running:

```typescript
// In packages/core/infrastructure/src/external-secrets/index.ts

export const webhookDeploymentReady = new k8s.apps.v1.Deployment(
  "external-secrets-webhook-ready",
  {},
  {
    dependsOn: [externalSecretsOperator],
  }
).status.apply(status => {
  if (!status || !status.readyReplicas || status.readyReplicas === 0) {
    throw new Error("External Secrets webhook not ready");
  }
  return status;
});
```

### Solution 3: Add Initialization Delay (NOT RECOMMENDED - Workaround Only)

As a temporary workaround, add a grace period:

```typescript
// This is a band-aid, not a proper solution
export const webhookReady = new k8s.core.v1.Pod(
  "webhook-init-delay",
  {
    metadata: {
      namespace: "external-secrets",
      name: "webhook-init-delay",
    },
    spec: {
      containers: [{
        name: "sleep",
        image: "busybox",
        command: ["sleep", "30"],
      }],
      restartPolicy: "Never",
    },
  },
  { dependsOn: [externalSecretsOperator] }
);
```

**This approach is not recommended** because:
- It's a timing hack, not a proper solution
- Adds unnecessary delay (30+ seconds) to deployment
- May fail if the cluster is slow or under load
- Not idempotent (might fail on updates)

## Recommended Implementation Path

### Step 1: Identify All External Secrets Dependencies

The following resources depend on the webhook being ready:
- `createGhcrPullSecret()` - creates ExternalSecret resources
- `createDockerHubPullSecret()` - creates ExternalSecret resources
- `pulumiEscStore` - ClusterSecretStore resource

### Step 2: Create a Webhook Readiness Waiter

Add to `packages/core/infrastructure/src/external-secrets/index.ts`:

```typescript
// Create a deployment reference to ensure webhook is running
export const webhookReady = externalSecretsOperator.ready.apply(() => {
  // The Helm Chart includes waitForJobs: true in v0.11.0
  // But we still need to explicitly wait for the webhook deployment
  return true;
});
```

### Step 3: Update All Dependencies

Update all resources that create ExternalSecret to depend on webhook readiness:

```typescript
{ dependsOn: [externalSecretsOperator, webhookReady] }
```

## Testing Strategy

1. **Local testing with fresh cluster**:
   ```bash
   pulumi stack rm dev --force
   pulumi up --stack dev
   ```

2. **Verify webhook is ready before ExternalSecrets**:
   ```bash
   kubectl get deployment -n external-secrets external-secrets-webhook
   kubectl get deployment -n external-secrets external-secrets
   ```

3. **Check for webhook pod readiness**:
   ```bash
   kubectl get pods -n external-secrets -l app=external-secrets-webhook
   ```

## Additional Notes

### Why This Happened

The issue was introduced because:
1. The `dependsOn` relationship was correctly set to the Helm chart
2. BUT Pulumi's Helm provider doesn't wait for pod readiness by default
3. The code assumes Helm chart completion = resources ready
4. In reality, there's a window where CRDs are registered but webhooks aren't responding

### Helm Chart Behavior

The `external-secrets` Helm chart (v0.11.0) deploys:
- **CRDs** immediately (via Helm hook `pre-install`)
- **Operator Pods** via Deployment (takes seconds to start)
- **Webhook Service** is created, but endpoints lag behind

The chart includes a `waitForJobs` parameter but this only waits for Jobs, not Deployments.

### Related Configuration

Current Helm values in `external-secrets/index.ts`:
```typescript
values: {
  installCRDs: true,        // ✓ CRDs installed
  webhook: {
    port: 9443,              // Webhook listening
  },
  resources: {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" },
  },
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 1000,
    fsGroup: 1000,
  },
}
```

Consider adding:
- `podAnnotations` with health check
- `startupProbe` configuration
- `serviceMonitor` for observability

## Implementation Checklist

- [ ] Implement webhook readiness waiter in `external-secrets/index.ts`
- [ ] Update `createGhcrPullSecret()` function signature
- [ ] Update `createDockerHubPullSecret()` function signature
- [ ] Update all callers in `base-infra/src/index.ts`
- [ ] Update `pulumiEscStore` dependency chain
- [ ] Test with fresh cluster reset
- [ ] Document in ADR 008 (secrets management)
- [ ] Add integration test for ordering

## References

- **Kubernetes Webhooks**: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/
- **External Secrets Operator Helm Chart**: https://charts.external-secrets.io
- **Pulumi Kubernetes Provider**: https://www.pulumi.com/registry/packages/kubernetes/
- **Pulumi Helm Provider**: https://www.pulumi.com/registry/packages/kubernetes/classes/helm.v3.chart/
