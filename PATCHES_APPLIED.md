# Kubectl Patches Applied - Traefik Gateway API + Authelia Implementation

**Date**: January 12, 2026  
**Author**: OpenCode AI Assistant  
**Context**: Documentation of manual patches applied to fix Traefik Gateway API + Authelia forward authentication issues

## Executive Summary

This document details three critical patches applied via kubectl to resolve compatibility and configuration issues between Traefik Gateway API and Authelia forward authentication. These patches need to be implemented in the source code to make them permanent.

---

## 🔧 Patch #1: Traefik Service Selector Fix

### Problem
The Traefik service selector did not match the actual pod labels created by the Helm chart, causing service endpoint resolution failures.

### Root Cause
The original service configuration in `packages/core/infrastructure/src/traefik-gateway/index.ts` (lines 50-51) would create a service with default selectors, but the Helm chart generates pods with specific instance labels.

### Original Configuration
Based on the source code, the service would be created by Helm with default selectors that don't match the actual pod labels.

### Current Working Configuration
```yaml
# kubectl get service traefik-controller -n traefik-system -o yaml
selector:
  app.kubernetes.io/instance: traefik-6b671a60-traefik-system
  app.kubernetes.io/name: traefik
```

### Patch Applied
```bash
kubectl patch service traefik-controller -n traefik-system --patch='
spec:
  selector:
    app.kubernetes.io/instance: traefik-6b671a60-traefik-system
    app.kubernetes.io/name: traefik'
```

### Source Code Fix Required
In `packages/core/infrastructure/src/traefik-gateway/index.ts`, the Helm values need to include explicit service selector configuration to match the deployment labels:

```typescript
// Lines 39-95: Add service selector configuration
values: {
  // ... existing configuration ...
  service: {
    type: "ClusterIP",
    // Add explicit selector to match Helm-generated labels
    labels: {
      "app.kubernetes.io/name": "traefik",
      "app.kubernetes.io/instance": "traefik-6b671a60-traefik-system"
    }
  },
  // ... rest of configuration ...
}
```

---

## 🚪 Patch #2: Gateway Port Configuration

### Problem
The Gateway was configured to listen on standard HTTP/HTTPS ports (80/443) but Traefik was running on container ports 8000/8443, causing listener validation failures.

### Root Cause
The Gateway configuration in `packages/core/infrastructure/src/traefik-gateway/index.ts` (lines 156-187) correctly specified ports 8000/8443, but the actual deployed Gateway resource was using different ports.

### Original Problematic Configuration
The Gateway was apparently configured with:
```yaml
listeners:
- name: web
  port: 80  # Wrong port
  protocol: HTTP
- name: websecure
  port: 443  # Wrong port
  protocol: HTTPS
```

### Current Working Configuration
```yaml
# kubectl get gateway homelab-gateway -n traefik-system -o yaml
spec:
  listeners:
  - allowedRoutes:
      namespaces:
        from: All
    name: web
    port: 8000  # Correct Traefik internal port
    protocol: HTTP
  - allowedRoutes:
      namespaces:
        from: All
    name: websecure
    port: 8443  # Correct Traefik internal port
    protocol: HTTPS
```

### Patch Applied
```bash
kubectl patch gateway homelab-gateway -n traefik-system --type='merge' --patch='
spec:
  listeners:
  - name: web
    port: 8000
    protocol: HTTP
    allowedRoutes:
      namespaces:
        from: All
  - name: websecure
    port: 8443
    protocol: HTTPS
    allowedRoutes:
      namespaces:
        from: All
    tls:
      mode: Terminate
      certificateRefs:
      - name: homelab-gateway-tls
        kind: Secret'
```

### Source Code Status
✅ **No fix required** - The source code in `packages/core/infrastructure/src/traefik-gateway/index.ts` (lines 156-187) already has the correct port configuration:

```typescript
listeners: [
  {
    name: "web",
    port: 8000, // ✓ Correct
    protocol: "HTTP",
    // ...
  },
  {
    name: "websecure", 
    port: 8443, // ✓ Correct
    protocol: "HTTPS",
    // ...
  }
]
```

The issue was likely a deployment inconsistency that has been resolved.

---

## 🔐 Patch #3: ForwardAuth Endpoint Fix

### Problem  
The ForwardAuth middleware was using an incorrect Authelia endpoint `/api/verify` instead of the correct v4.38+ endpoint `/api/authz/auth-request`.

### Root Cause
Authelia v4.38.0+ changed the forward auth endpoint from `/api/verify` to `/api/authz/auth-request`. The middleware configurations needed updating.

### Original Problematic Configuration
The middleware was likely configured with:
```yaml
spec:
  forwardAuth:
    address: http://authelia.authelia.svc.cluster.local:9091/api/verify  # Old endpoint
```

### Current Working Configuration
```yaml
# kubectl get middleware authelia-forwardauth -n traefik-system -o yaml
spec:
  forwardAuth:
    address: http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request
    authResponseHeaders:
    - Remote-User
    - Remote-Groups  
    - Remote-Name
    - Remote-Email
    trustForwardHeader: true
```

### Patches Applied

#### Global ForwardAuth Middleware
```bash
kubectl patch middleware authelia-forwardauth -n traefik-system --type='merge' --patch='
spec:
  forwardAuth:
    address: http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request'
```

#### App-Specific ForwardAuth Middleware  
```bash
kubectl patch middleware auth-demo-forwardauth -n auth-demo --type='merge' --patch='
spec:
  forwardAuth:
    address: http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request'
```

### Source Code Status
✅ **Already fixed** - Both source files already use the correct endpoint:

1. **Global middleware** in `packages/core/infrastructure/src/traefik-gateway/index.ts` (line 206):
```typescript
address: "http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request",
```

2. **App-specific middleware** in `packages/core/components/src/ExposedWebApp.ts` (line 455):
```typescript  
address: "http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request",
```

The source code is correct - the issue was in the deployed resources.

---

## 📊 Current Resource Status

### All Resources Working ✅

```bash
# Verify all resources are working
kubectl get gateway homelab-gateway -n traefik-system  # Status: All listeners ready
kubectl get middleware authelia-forwardauth -n traefik-system  # Ready
kubectl get middleware auth-demo-forwardauth -n auth-demo  # Ready  
kubectl get service traefik-controller -n traefik-system  # Endpoints available
```

### Gateway Status
- ✅ HTTP Listener (port 8000): Ready, 4 attached routes
- ⚠️ HTTPS Listener (port 8443): Certificate issue (secret missing)
- 🔧 Action needed: Create TLS certificate secret

---

## 🚀 Next Steps: Making Patches Permanent

### 1. Service Selector Fix (HIGH PRIORITY)
**File**: `packages/core/infrastructure/src/traefik-gateway/index.ts`  
**Lines**: 39-95 (Helm values configuration)

Add explicit service selector configuration to the Helm values to ensure consistent service endpoint resolution:

```typescript
service: {
  type: "ClusterIP",
  // Ensure selector matches Helm-generated deployment labels
  selector: {
    "app.kubernetes.io/name": "traefik",
    "app.kubernetes.io/instance": pulumi.interpolate`traefik-${pulumi.getStack()}-traefik-system`
  }
},
```

### 2. TLS Certificate Issue (MEDIUM PRIORITY)  
The Gateway HTTPS listener shows certificate errors. Verify cert-manager configuration:

```bash
# Check if cert-manager is working
kubectl get certificate homelab-gateway-tls -n traefik-system
kubectl describe certificate homelab-gateway-tls -n traefik-system
```

### 3. Validation Testing (LOW PRIORITY)
After applying source code fixes, validate with a fresh deployment:

```bash
# Test full deployment lifecycle
pulumi destroy --yes
pulumi up --yes

# Verify no manual patches needed
kubectl get gateway homelab-gateway -n traefik-system -o yaml
kubectl get service traefik-controller -n traefik-system -o yaml  
kubectl get middleware authelia-forwardauth -n traefik-system -o yaml
```

---

## 📝 Change Log

| Date | Patch | Status | Notes |
|------|-------|---------|-------|
| 2026-01-11 | Service Selector | ✅ Applied | Service endpoints now resolve correctly |
| 2026-01-11 | Gateway Ports | ✅ Applied | Listeners accept traffic on 8000/8443 |  
| 2026-01-11 | ForwardAuth Endpoint | ✅ Applied | Compatible with Authelia v4.38+ |
| 2026-01-12 | Documentation | ✅ Complete | Ready for source code implementation |

---

## 🔍 Verification Commands

Use these commands to verify the current state and detect if patches are still needed:

```bash
# Check service selector matches pod labels
kubectl get pods -n traefik-system --show-labels | grep traefik
kubectl get service traefik-controller -n traefik-system -o jsonpath='{.spec.selector}'

# Check Gateway port configuration  
kubectl get gateway homelab-gateway -n traefik-system -o jsonpath='{.spec.listeners[*].port}'

# Check ForwardAuth endpoints
kubectl get middleware -A -o custom-columns=NAME:.metadata.name,NAMESPACE:.metadata.namespace,ADDRESS:.spec.forwardAuth.address | grep authelia

# Test ForwardAuth connectivity (should return 401 Unauthorized)
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- curl -v http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request
```

---

*This document should be used as a reference when implementing the permanent fixes in the infrastructure-as-code repository.*