# OAuth2-Proxy Authentication Guide

This guide explains how OAuth2-Proxy is implemented as an alternative authentication system in the homelab infrastructure.

## Overview

**OAuth2-Proxy** provides GitHub-based authentication as an independent alternative to Authelia. Routes can be protected by:
- **OAuth2-Proxy**: For GitHub-authenticated users (external developers, open-source contributors)
- **Authelia**: For internal users with local accounts (service accounts, MFA requirements)

A route uses **one or the other**, never both.

## Architecture

### Component Layout

```
Kubernetes Cluster
├── oauth2-proxy namespace (shared infrastructure)
│   ├── oauth2-proxy-github Secret (shared OAuth credentials)
│   ├── oauth2-emails-{group} ConfigMaps (per-group email allowlists)
│   ├── oauth2-proxy-{group} Deployments (one per group)
│   ├── oauth2-proxy-{group} Services (one per group)
│   ├── oauth2-shared-redirect (SHARED: ConfigMap + Deployment + Service)
│   │   └── Single nginx instance serves all apps (30% resource reduction)
│   └── oauth2-callback HTTPRoute (GitHub redirect endpoint)
│
├── authelia namespace (unchanged)
│   └── ... (Authelia components)
│
└── app namespaces (e.g., oauth2-demo)
    ├── App Deployment & Service
    ├── oauth2-forwardauth Middleware (ForwardAuth to oauth2-proxy)
    ├── oauth2-errors Middleware (catches 401 → shared redirect service)
    ├── oauth2-chain Middleware (combines errors + forwardauth)
    └── IngressRoutes (protected app + /oauth2/* endpoints)
```

**Key Optimization**: The redirect service is **shared across all apps** in the `oauth2-proxy` namespace, eliminating 3 Kubernetes resources (ConfigMap, Deployment, Service) per app.

### Authentication Flow

```
Browser → Cloudflare (TLS termination) → Tunnel → Traefik (HTTP/web entryPoint)
  │
  ├─ Match IngressRoute with oauth2-chain middleware
  │
  ├─ ForwardAuth middleware calls oauth2-proxy /oauth2/auth
  │  └─ Forwards Cookie header from browser (authRequestHeaders: ["Cookie"])
  │
  └─ oauth2-proxy checks session:
     │
     ├─ Valid session cookie?
     │  ├─ NO → Return 401
     │  │  └─ Errors middleware catches 401
     │  │     └─ Calls SHARED redirect service (oauth2-proxy namespace)
     │  │        └─ Returns HTML with JS redirect to /oauth2/start?rd={original_url}
     │  │           └─ oauth2-proxy returns 302 to GitHub OAuth
     │  │              └─ After GitHub auth → callback → cookie set → redirect back
     │  │
     │  └─ YES → Email in allowlist?
     │     ├─ YES → Return 200 + X-Auth-Request-* headers
     │     │  └─ Request proceeds to backend
     │     └─ NO → Return 403 Forbidden
```

### Why This Architecture?

**Traefik ForwardAuth Limitation**: When oauth2-proxy returns 302 (redirect to GitHub), Traefik converts it to 401. Browsers don't follow `Location` headers on 401 responses.

**Solution**: 
1. Use `/oauth2/auth` endpoint (returns 200 or 401, not 302)
2. Errors middleware catches 401 and calls shared redirect service
3. Shared redirect service uses JavaScript/meta-refresh to go to `/oauth2/start?rd={url}`
4. `/oauth2/start` returns proper 302 to GitHub

**Why Shared Redirect Service?**
- **Resource Efficiency**: One nginx pod serves all OAuth2-Proxy apps (vs one per app)
- **Scalability**: With 10 apps, saves 30 Kubernetes resources (3 per app)
- **Maintainability**: Single service to update vs per-app configurations
- **URL Handling**: Uses Traefik's `{url}` placeholder in errors query parameter

**Why IngressRoute instead of HTTPRoute?**
- IngressRoute (Traefik CRD) supports cross-namespace service references directly
- Gateway API HTTPRoute + Middleware ExtensionRef has provider namespace mismatch issues

**Why "web" entryPoint?**
- Cloudflare Tunnel terminates TLS externally
- Traffic arrives at Traefik as HTTP on the "web" entryPoint (port 8000)

### Group-Based Authorization

Each group gets:
1. **Email Allowlist** (ConfigMap): `oauth2-emails-{group}` with one email per line
2. **OAuth2-Proxy Instance** (Helm Release): `oauth2-proxy-{group}` with unique cookie name

**Example Groups**:
- `users`: General GitHub users who should have access

## How to Use

### Protecting a New Route with OAuth2-Proxy

**Using the `ExposedWebApp` component (recommended):**

```typescript
import { AuthType } from "@mrsimpson/homelab-core-components";

const myApp = homelab.createExposedWebApp("my-app", {
  image: "my-app:latest",
  domain: "my-app.no-panic.org",
  port: 8080,
  auth: AuthType.OAUTH2_PROXY,    // GitHub authentication
  oauth2Proxy: { group: "users" }, // Which group (defaults to "users")
});
```

This automatically creates the full middleware stack:
- ForwardAuth middleware (calls `/oauth2/auth` with cookie forwarding)
- Errors middleware (catches 401 → calls shared redirect service)
- Chain middleware (errors + forwardauth)
- IngressRoute for `/oauth2/*` (sign-in flow, unprotected)
- IngressRoute for `/*` (app, protected by chain middleware)

**No per-app redirect service needed** - uses shared `oauth2-shared-redirect` in oauth2-proxy namespace!

**Comparison with Authelia:**

```typescript
// Authelia (existing)
auth: AuthType.FORWARD,

// OAuth2-Proxy (new)
auth: AuthType.OAUTH2_PROXY,
oauth2Proxy: { group: "users" },
```

**For manual/advanced setup**, see `packages/core/infrastructure/src/oauth2-proxy/example-route.ts` for the low-level IngressRoute and middleware configuration.

<details>
<summary>Manual middleware stack reference (for advanced use)</summary>

The `ExposedWebApp` component creates these resources automatically. Only use manual setup if you need custom configuration.

1. **ForwardAuth Middleware** - Calls `/oauth2/auth` to check session
   ```typescript
   spec: {
     forwardAuth: {
       address: "http://oauth2-proxy-users.oauth2-proxy.svc.cluster.local/oauth2/auth",
       trustForwardHeader: true,
       authRequestHeaders: ["Cookie", "Authorization"],  // CRITICAL!
       authResponseHeaders: ["X-Auth-Request-User", "X-Auth-Request-Email", "Set-Cookie"],
     }
   }
   ```

2. **Redirect Service** - nginx serving JS redirect page for 401 handling

3. **Errors Middleware** - Catches 401, serves redirect page

4. **Chain Middleware** - Combines errors + forwardauth

5. **IngressRoute for /oauth2/*** - Routes sign-in traffic to oauth2-proxy (unprotected)

6. **IngressRoute for /** - Protected route with middleware chain (priority: 1)

</details>

### Adding Users to a Group

1. **Edit group configuration**
   ```bash
   vim packages/core/infrastructure/src/oauth2-proxy/groups.ts
   ```
   
   ```typescript
   export const groups: Record<string, string[]> = {
     users: [
       "github@beimir.net",
       "newuser@example.com",  // ← Add here
     ],
   };
   ```

2. **Deploy changes**
   ```bash
   pulumi up
   ```

3. **Automatic pod restart**
   - ConfigMap is updated automatically
   - Pod annotation checksum changes
   - oauth2-proxy pod restarts
   - New user can now access protected routes

### Creating a New Group

1. **Add group to configuration**
   ```typescript
   export const groups: Record<string, string[]> = {
     users: ["github@beimir.net"],
     admins: ["admin@example.com"],
   };
   ```

2. **Deploy**
   ```bash
   pulumi up
   ```

3. **Created automatically**:
   - ConfigMap `oauth2-emails-admins`
   - Helm Release `oauth2-proxy-admins`
   - Service `oauth2-proxy-admins`

4. **Use the new group in an app**:
   ```typescript
   auth: AuthType.OAUTH2_PROXY,
   oauth2Proxy: { group: "admins" },
   ```

## Configuration Reference

### GitHub OAuth App Settings

- **Application Name**: homelab-oauth2-proxy
- **Homepage URL**: https://apps.no-panic.org
- **Authorization Callback URL**: https://oauth.no-panic.org/oauth2/callback

### Helm Chart Values

| Setting | Value | Purpose |
|---------|-------|---------|
| `provider` | github | Use GitHub OAuth |
| `redirect-url` | https://oauth.{domain}/oauth2/callback | Callback endpoint |
| `whitelist-domain` | .{domain} | Allow subdomain redirects |
| `cookie-name` | `_oauth2_{group}` | Unique per group |
| `cookie-domain` | `.{domain}` | Wildcard for all subdomains |
| `cookie-secure` | true | HTTPS only |
| `cookie-expire` | 168h | 7-day session |
| `reverse-proxy` | true | Trust X-Forwarded headers |
| `set-xauthrequest` | true | Set X-Auth-Request-* headers |

### Traefik Requirements

```typescript
// In traefik-gateway/index.ts
providers: {
  kubernetesCRD: {
    enabled: true,
    allowCrossNamespace: true,      // For cross-namespace service refs
    allowExternalNameServices: true, // For ExternalName services
  }
}
```

## Decision Matrix: OAuth2-Proxy vs. Authelia

| Requirement | OAuth2-Proxy | Authelia |
|------------|--------------|----------|
| GitHub authentication | Yes | No |
| Local user accounts | No | Yes |
| Email-based allowlists | Yes | Rules-based |
| MFA support | No (GitHub handles) | Yes (TOTP/WebAuthn) |
| External contributors | Yes | No |
| Configuration as code | Yes (Pulumi) | Partial (YAML) |

**Recommendation**:
- **Use OAuth2-Proxy** for: Public/semi-public apps, external developers, GitHub users
- **Use Authelia** for: Internal tools, service accounts, MFA-required resources

## Troubleshooting

### Infinite Redirect Loop After GitHub Auth

**Cause**: ForwardAuth not forwarding Cookie header to oauth2-proxy

**Fix**: Ensure middleware has `authRequestHeaders: ["Cookie", "Authorization"]`

### 401 with "Found" Link Instead of Auto-Redirect

**Cause**: Missing redirect service and errors middleware

**Fix**: Add the complete middleware stack (see example-route.ts)

### 404 on /oauth2/* Endpoints

**Cause**: Wrong entryPoint or missing IngressRoute

**Fix**: 
1. Use `entryPoints: ["web"]` (not "websecure" - Cloudflare terminates TLS)
2. Verify /oauth2/* IngressRoute exists

### User Can't Access After Email Added

**Cause**: Pod hasn't restarted yet

**Fix**:
```bash
# Wait for automatic restart or force it:
kubectl rollout restart deployment/oauth2-proxy-users -n oauth2-proxy
```

### Session Lost / Cookie Issues

**Check**:
1. Cookie domain matches app hostname (`.no-panic.org` for `*.no-panic.org`)
2. `reverse-proxy: true` is set in oauth2-proxy config
3. Browser isn't blocking third-party cookies

## Related Documentation

- [OAuth2-Proxy Configuration](https://oauth2-proxy.github.io/oauth2-proxy/configuration/)
- [Traefik ForwardAuth](https://doc.traefik.io/traefik/middlewares/http/forwardauth/)
- [Traefik IngressRoute](https://doc.traefik.io/traefik/routing/providers/kubernetes-crd/)
