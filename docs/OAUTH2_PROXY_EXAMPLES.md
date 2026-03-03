# OAuth2-Proxy Examples

This document provides step-by-step examples for common OAuth2-Proxy tasks.

## Example 1: Adding a New User to Existing Group

**Scenario**: You want to give `alice@example.com` access to all OAuth2-Proxy protected routes in the `users` group.

**Steps**:

1. **Locate the groups configuration**
   ```bash
   vim packages/core/infrastructure/src/oauth2-proxy/groups.ts
   ```

2. **Add the email to the users group**
   ```typescript
   export const groups: Record<string, string[]> = {
     users: [
       "github@beimir.net",
       "alice@example.com",  // ← Add here
     ],
   };
   ```

3. **Save and deploy**
   ```bash
   pulumi up
   ```

4. **What happens automatically**:
   - ConfigMap `oauth2-emails-users` is updated
   - Pod annotation checksum changes
   - `oauth2-proxy-users` pod is automatically restarted
   - Alice can now log in via GitHub OAuth

**Verification**:
```bash
# Verify the ConfigMap was updated
kubectl get configmap oauth2-emails-users -n oauth2-proxy -o jsonpath='{.data.restricted_user_access}'

# Verify pod restarted
kubectl get pods -n oauth2-proxy -w
```

## Example 2: Creating a New Group (Developers)

**Scenario**: You want to create a separate `developers` group for your dev team.

**Steps**:

1. **Add the new group to configuration**
   ```bash
   vim packages/core/infrastructure/src/oauth2-proxy/groups.ts
   ```

2. **Define the group with its members**
   ```typescript
   export const groups: Record<string, string[]> = {
     users: [
       "github@beimir.net",
     ],
     developers: [  // ← New group
       "alice@example.com",
       "bob@example.com",
     ],
   };
   ```

3. **Deploy the new group**
   ```bash
   pulumi up
   ```

4. **What gets created automatically**:
   - ConfigMap: `oauth2-emails-developers`
   - Helm Release: `oauth2-proxy-developers` (deployment, service)

5. **Verify components were created**
   ```bash
   kubectl get configmap -n oauth2-proxy | grep developers
   kubectl get deployment -n oauth2-proxy | grep developers
   kubectl get svc -n oauth2-proxy | grep developers
   ```

## Example 3: Protecting a New Application

**Scenario**: You have a new app and want to protect it with OAuth2-Proxy.

### Using `ExposedWebApp` (recommended)

```typescript
import { AuthType } from "@mrsimpson/homelab-core-components";

// In src/index.ts or your app module:
export const myApp = homelab.createExposedWebApp("my-app", {
  image: "my-app:latest",
  domain: "my-app.no-panic.org",
  port: 8080,
  auth: AuthType.OAUTH2_PROXY,
  oauth2Proxy: { group: "users" },
});
```

**That's it.** The component automatically creates:
- Namespace, Deployment, Service
- ForwardAuth middleware (with cookie forwarding)
- Errors middleware (references shared redirect service)
- Chain middleware (errors + forwardauth)
- IngressRoutes for `/oauth2/*` and `/*`
- Cloudflare DNS record

**Uses shared redirect service** - no per-app nginx deployment needed!

**Deploy:**
```bash
pulumi up
```

**Verify:**
```bash
kubectl get all,middlewares,ingressroutes -n my-app
```

<details>
<summary>Manual setup (for advanced/custom configuration)</summary>

See `packages/core/infrastructure/src/oauth2-proxy/example-route.ts` for the full manual implementation pattern. This involves creating:

1. ForwardAuth Middleware with `authRequestHeaders: ["Cookie", "Authorization"]`
2. Errors Middleware (catches 401 → calls shared redirect service in oauth2-proxy namespace)
3. Chain Middleware (errors + forwardauth)
4. IngressRoute for `/oauth2/*` → oauth2-proxy (unprotected)
5. IngressRoute for `/*` → app (protected by chain, priority: 1)
6. Cloudflare DNS record

**Note**: The shared redirect service (`oauth2-shared-redirect`) in the `oauth2-proxy` namespace is automatically available - no need to create per-app redirect resources.

All IngressRoutes use `entryPoints: ["web"]` (Cloudflare terminates TLS).

</details>

## Example 4: Removing a User from a Group

**Scenario**: Alice leaves the team and should no longer have access.

**Steps**:

1. **Edit the groups configuration**
   ```bash
   vim packages/core/infrastructure/src/oauth2-proxy/groups.ts
   ```

2. **Remove the email**
   ```typescript
   export const groups: Record<string, string[]> = {
     users: [
       "github@beimir.net",
       // "alice@example.com",  ← Removed
     ],
   };
   ```

3. **Deploy**
   ```bash
   pulumi up
   ```

4. **Result**:
   - ConfigMap is updated
   - Pod restarts automatically
   - Alice can no longer access protected routes

**Note**: Existing session cookies remain valid until expiry (7 days default). For immediate revocation, rotate the cookie secret.

## Example 5: Debugging Authentication Issues

### Check oauth2-proxy logs

```bash
# View authentication attempts
kubectl logs -n oauth2-proxy -l app.kubernetes.io/name=oauth2-proxy --tail=100

# Watch in real-time
kubectl logs -n oauth2-proxy -l app.kubernetes.io/name=oauth2-proxy -f

# Filter for specific events
kubectl logs -n oauth2-proxy -l app.kubernetes.io/name=oauth2-proxy | grep -E "AuthSuccess|Forbidden|Error"
```

### Check Traefik logs

```bash
kubectl logs -n traefik-system -l app.kubernetes.io/name=traefik --tail=50
```

### Check middleware configuration

```bash
# List middlewares in app namespace
kubectl get middlewares -n my-app

# Check ForwardAuth config
kubectl get middleware oauth2-forwardauth -n my-app -o yaml

# Verify authRequestHeaders includes Cookie
kubectl get middleware oauth2-forwardauth -n my-app -o jsonpath='{.spec.forwardAuth.authRequestHeaders}'
```

### Test oauth2-proxy directly

```bash
# Test /oauth2/auth endpoint (should return 401 without cookie)
kubectl run -n oauth2-proxy curl-test --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sI "http://oauth2-proxy-users.oauth2-proxy.svc.cluster.local/oauth2/auth"

# Test /oauth2/start endpoint (should return 302 to GitHub)
kubectl run -n oauth2-proxy curl-test --rm -it --restart=Never --image=curlimages/curl -- \
  curl -sI "http://oauth2-proxy-users.oauth2-proxy.svc.cluster.local/oauth2/start?rd=https://example.com/"
```

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Infinite redirect loop | Cookie not forwarded | Add `authRequestHeaders: ["Cookie"]` |
| 401 with "Found" link | Missing redirect service | Add errors middleware + redirect service |
| 404 on /oauth2/* | Wrong entryPoint | Use `entryPoints: ["web"]` not "websecure" |
| 500 error | Service resolution failed | Check cross-namespace service name |

## Example 6: Using Different Groups for Different Apps

**Scenario**: Admin dashboard for admins only, regular app for all users.

### 1. Define both groups

```typescript
export const groups: Record<string, string[]> = {
  users: [
    "github@beimir.net",
    "alice@example.com",
    "bob@example.com",
  ],
  admins: [
    "github@beimir.net",  // Admin is also a user
  ],
};
```

### 2. Regular app uses `users` group

```typescript
const regularApp = homelab.createExposedWebApp("regular-app", {
  image: "my-app:latest",
  domain: "app.no-panic.org",
  port: 8080,
  auth: AuthType.OAUTH2_PROXY,
  oauth2Proxy: { group: "users" },
});
```

### 3. Admin app uses `admins` group

```typescript
const adminApp = homelab.createExposedWebApp("admin-app", {
  image: "admin-dashboard:latest",
  domain: "admin.no-panic.org",
  port: 8080,
  auth: AuthType.OAUTH2_PROXY,
  oauth2Proxy: { group: "admins" },
});
```

### 4. Result

- Alice and Bob can access the regular app
- Only the admin (github@beimir.net) can access the admin dashboard
- Each group has independent session cookies (`_oauth2_users` vs `_oauth2_admins`)
