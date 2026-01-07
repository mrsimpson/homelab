# Kubernetes Cluster Teardown Guide

This document explains how to properly tear down and clean up the Pulumi-managed Kubernetes cluster, including handling edge cases with stuck namespaces.

## Quick Teardown (Normal Case)

```bash
cd /path/to/homelab

# Destroy all resources managed by Pulumi
pulumi destroy --stack dev --yes

# Clean up the Pulumi stack metadata
pulumi stack rm dev --yes

# Initialize a fresh stack for next deployment
pulumi stack init dev
```

### What This Does:
1. **pulumi destroy** - Deletes all Kubernetes resources (namespaces, deployments, services, etc.)
2. **pulumi stack rm** - Removes the Pulumi stack history
3. **pulumi stack init** - Creates a fresh stack for future deployments

**Typical Duration**: 30-60 seconds

---

## Handling Stuck Namespaces

### Problem
Sometimes namespaces get stuck in "Terminating" state, usually due to Longhorn CRD instances with finalizers that can't be deleted. This prevents the namespace from fully deleting.

### Symptoms
```bash
$ kubectl get namespaces
NAME                STATUS        AGE
longhorn-system     Terminating   1h
```

### Root Cause
CRD instances (like `nodes.longhorn.io` and `engineimages.longhorn.io`) have finalizers that are preventing deletion. The Kubernetes garbage collector is waiting for these resources to be cleaned up but something is blocking them.

### Solution

**Step 1: Identify Stuck CRD Resources**
```bash
# Check for stuck Longhorn node resources
kubectl get nodes.longhorn.io -n longhorn-system

# Check for stuck engine image resources
kubectl get engineimages.longhorn.io -n longhorn-system
```

**Step 2: Remove Finalizers**
```bash
# Remove finalizers from all stuck Longhorn nodes
kubectl get nodes.longhorn.io -n longhorn-system -o name | while read node; do
  kubectl -n longhorn-system patch "$node" -p '{"metadata":{"finalizers":[]}}' --type merge
done

# Remove finalizers from all stuck engine images
kubectl get engineimages.longhorn.io -n longhorn-system -o name | while read ei; do
  kubectl -n longhorn-system patch "$ei" -p '{"metadata":{"finalizers":[]}}' --type merge
done
```

**Step 3: Wait for Namespace Deletion**
```bash
# Monitor namespace deletion
kubectl get namespaces | grep -i terminating

# Wait 10-30 seconds, then verify
kubectl get namespaces
```

The namespace should now be deleted.

**Full Cleanup After Stuck Namespace:**
```bash
# If namespaces are still stuck, force delete by removing finalizers from namespace itself
kubectl get ns -o json | jq '.items[] | select(.status.phase=="Terminating") | .metadata.name' | \
  while read ns; do
    kubectl patch ns "$ns" -p '{"spec":{"finalizers":[]}}' --type merge
  done

# Wait for cleanup
sleep 20

# Then proceed with normal teardown
pulumi destroy --stack dev --yes
pulumi stack rm dev --yes
pulumi stack init dev
```

---

## Complete Fresh Start

If you need a completely clean slate:

```bash
# 1. Destroy Pulumi stack
pulumi destroy --stack dev --yes

# 2. Force-clean any stuck namespaces
kubectl get ns -o json | jq '.items[] | select(.status.phase=="Terminating") | .metadata.name' | \
  while read ns; do
    echo "Cleaning up stuck namespace: $ns"
    
    # Get all CRD resources in the namespace
    kubectl api-resources --namespaced -o name | while read resource; do
      kubectl get "$resource" -n "$ns" -o name 2>/dev/null | while read item; do
        kubectl -n "$ns" patch "$item" -p '{"metadata":{"finalizers":[]}}' --type merge 2>/dev/null || true
      done
    done
    
    # Remove finalizers from namespace itself
    kubectl patch ns "$ns" -p '{"spec":{"finalizers":[]}}' --type merge 2>/dev/null || true
  done

# 3. Wait for all namespaces to be deleted
sleep 30

# 4. Verify cluster is clean
kubectl get namespaces

# 5. Remove Pulumi stack
pulumi stack rm dev --yes

# 6. Create fresh stack
pulumi stack init dev
```

---

## Why Namespaces Get Stuck

1. **Longhorn Finalizers**: Longhorn adds finalizers to its CRD resources to ensure they're properly cleaned up. If the Longhorn webhook/manager is unavailable or crashed, these finalizers can't be processed.

2. **Webhook Availability**: If ValidatingWebhookConfigurations or MutatingWebhookConfigurations reference services that no longer exist, the Kubernetes API server can't contact them to validate deletion, causing resources to hang.

3. **Circular Dependencies**: Sometimes resources have interdependent finalizers that deadlock.

### Prevention

For future deployments, ensure Longhorn is properly uninstalled before cluster teardown:

```bash
# Wait for longhorn to shut down cleanly (if it was running)
kubectl wait --for=delete namespace/longhorn-system --timeout=300s || true
```

---

## Verifying Clean Cluster

After teardown, verify the cluster is clean:

```bash
# Should only show system namespaces
kubectl get namespaces

# Should show no custom resources
kubectl get all -A

# Should show no CRDs (except system ones)
kubectl get crd | grep -v kubernetes.io || echo "No custom CRDs found"
```

---

## Next Steps

Once cluster is clean, redeploy:

```bash
cd /path/to/homelab

# Verify config is set
cat Pulumi.dev.yaml

# Deploy fresh stack
pulumi up --stack dev --yes
```


---

## Deployment Status

After successful `pulumi up`, verify the infrastructure is running:

```bash
# Check all namespaces are created
$ kubectl get namespaces
NAME                STATUS   AGE
cert-manager        Active   5m
cloudflare          Active   5m
external-secrets    Active   5m
hello-world         Active   5m
ingress-nginx       Active   5m
longhorn-system     Active   5m
nodejs-demo         Active   5m
storage-validator   Active   5m

# Verify core infrastructure pods are running
$ kubectl get pods -n cert-manager -n ingress-nginx
NAME                                           READY   STATUS    RESTARTS   AGE
cert-manager-46f4e900-566bd57c87-f4kmr         1/1     Running   0          5m
cert-manager-46f4e900-cainjector-...           1/1     Running   0          5m
cert-manager-46f4e900-webhook-b658d9575-...    1/1     Running   0          5m
ingress-nginx-4d837d35-controller-...          1/1     Running   0          5m

# Check storage classes
$ kubectl get storageclass | grep longhorn
longhorn                   driver.longhorn.io      Delete          Immediate              true           5m
longhorn-persistent       driver.longhorn.io      Delete          WaitForFirstConsumer    true           5m
longhorn-uncritical       driver.longhorn.io      Delete          WaitForFirstConsumer    true           5m
```

---

## Key Implementation Details

### Explicit Dependencies Fix

The core fix for reliable cluster deployment was implementing **explicit `dependsOn` directives** on Helm releases:

```typescript
// Before (implicit dependency):
export const certManager = new k8s.helm.v3.Chart(
  "cert-manager",
  {
    namespace: certManagerNamespace.metadata.apply((m) => m.name), // Implicit dependency
    // ...
  },
  {
    dependsOn: [certManagerNamespace], // But also explicit - redundant
  }
);

// After (explicit dependency):
export const certManager = new k8s.helm.v3.Release(
  "cert-manager",
  {
    namespace: "cert-manager", // String directly
    // ...
  },
  {
    dependsOn: [certManagerNamespace], // Explicit - clear and reliable
  }
);
```

This ensures:
1. Namespace resource is created FIRST
2. Helm release waits for namespace to exist
3. No race conditions between namespace and Helm chart creation
4. Pulumi's dependency engine can properly sequence all operations

---

## Architecture Note

The fix demonstrates a key principle: **In Pulumi, explicit is better than implicit**

- **Implicit dependencies** (via Output references) are convenient but can be missed by the dependency engine
- **Explicit dependencies** (`dependsOn` array) guarantee proper sequencing
- **String values** are concrete and don't create unnecessary complexity
- **Resource exports** ensure resources are included in the stack

This pattern is applied consistently across all infrastructure modules for reliable, repeatable deployments.

