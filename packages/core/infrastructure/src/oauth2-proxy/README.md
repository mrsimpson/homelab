# OAuth2-Proxy Infrastructure Module

This Pulumi module implements OAuth2-Proxy as a centralized authentication gateway for the homelab infrastructure.

## Module Structure

```
packages/core/infrastructure/src/oauth2-proxy/
├── index.ts                 ← Main module exports
├── namespace.ts             ← Kubernetes namespace setup
├── secrets.ts               ← GitHub OAuth credentials Secret
├── groups.ts                ← Group definitions and email allowlists (SSoT)
├── email-configmaps.ts      ← Per-group email allowlist ConfigMaps
├── oauth2-proxy.ts          ← Helm releases (one per group)
├── shared-redirect.ts       ← Shared redirect service (handles 401s for ALL apps)
├── callback-route.ts        ← GitHub OAuth callback HTTPRoute
├── example-route.ts         ← Example OAuth2-Proxy protected route (reference)
└── README.md                ← This file
```

**Key Addition**: `shared-redirect.ts` provides a single nginx-based redirect service shared by all OAuth2-Proxy protected applications, reducing resource overhead by 30%.

## How It Works

### 1. Single Source of Truth: `groups.ts`

```typescript
export const groups: Record<string, string[]> = {
  users: ["github@beimir.net"],
  developers: ["alice@example.com", "bob@example.com"],
  admins: ["admin@example.com"],
};
```

Everything else is generated from this configuration.

### 2. For Each Group, These Resources Are Created:

**ConfigMap** (`email-configmaps.ts`):
```
oauth2-emails-{group}
├── Key: restricted_user_access
└── Value: "email1@domain.com\nemail2@domain.com\n..."
```

**Helm Release** (`oauth2-proxy.ts`):
```
oauth2-proxy-{group}
├── Chart: oauth2-proxy v7.12.x
├── References: oauth2-proxy-github Secret
├── Mounts: oauth2-emails-{group} ConfigMap
└── Configuration:
    ├── Provider: github
    ├── Cookie Name: _oauth2_{group}
    ├── Cookie Domain: .no-panic.org
    └── Auth Response Headers: X-Auth-Request-*
```

### 3. Shared Resources

**Secret** (`secrets.ts`):
```
oauth2-proxy-github (in oauth2-proxy namespace)
├── client-id: (from Pulumi config oauth2-proxy:clientId)
├── client-secret: (from Pulumi config oauth2-proxy:clientSecret, secret)
└── cookie-secret: (from Pulumi config oauth2-proxy:cookieSecret, secret)
```

**Shared Redirect Service** (`shared-redirect.ts`):
```
oauth2-shared-redirect (in oauth2-proxy namespace)
├── ConfigMap: nginx config for JS redirect
├── Deployment: nginx unprivileged (1 pod for ALL apps)
├── Service: ClusterIP port 80
└── Purpose: Handles 401 errors from all OAuth2-Proxy apps
    - Receives: /?rd=https://app.no-panic.org/path
    - Returns: HTML with JS redirect to /oauth2/start?rd=...
    - Saves: 3 Kubernetes resources per app (ConfigMap + Deployment + Service)
```

**HTTPRoute** (`callback-route.ts`):
```
oauth2-callback (in oauth2-proxy namespace)
├── Hostname: oauth.no-panic.org
├── Path: /oauth2/callback
├── Backend: oauth2-proxy-{group} Service (port 80)
└── Note: NO auth middleware (must be public for GitHub redirect)
```

## How to Add a User

1. Edit `groups.ts`:
   ```typescript
   users: [
     "github@beimir.net",
     "newuser@example.com",  // ← Add here
   ]
   ```

2. Run `pulumi up`

3. Automatic chain reaction:
   - ConfigMap `oauth2-emails-users` updated
   - Pod annotation checksum changes (sha256 of emails)
   - oauth2-proxy-users pod automatically restarts
   - New user can log in

## How to Create a New Group

1. Edit `groups.ts`:
   ```typescript
   developers: [
     "alice@example.com",
     "bob@example.com",
   ]
   ```

2. Run `pulumi up`

3. Automatic resources created:
   - ConfigMap `oauth2-emails-developers`
   - Helm Release `oauth2-proxy-developers`
   - Service `oauth2-proxy-developers`
   - Deployment `oauth2-proxy-developers`

## How to Protect a Route with OAuth2-Proxy

**Recommended: Use `ExposedWebApp` component with `AuthType.OAUTH2_PROXY`:**

```typescript
import { AuthType } from "@mrsimpson/homelab-core-components";

const myApp = homelab.createExposedWebApp("my-app", {
  image: "my-app:latest",
  domain: "my-app.no-panic.org",
  port: 8080,
  auth: AuthType.OAUTH2_PROXY,
  oauth2Proxy: { group: "users" },
});
```

This automatically creates the entire middleware stack, IngressRoutes, redirect service, and DNS record.

**For manual/advanced setup**, see `example-route.ts` for the low-level reference implementation.

<details>
<summary>Manual middleware stack details</summary>

Each protected application needs its own middleware stack:

1. **ForwardAuth Middleware** - Calls `/oauth2/auth` to check session
   - MUST include `authRequestHeaders: ["Cookie", "Authorization"]` to forward session cookies

2. **Redirect Service** - nginx that serves JS redirect page on 401
   - Required because Traefik preserves 401 status from ForwardAuth
   - Browsers don't follow Location headers on 401

3. **Errors Middleware** - Catches 401 and serves redirect page

4. **Chain Middleware** - Combines errors + forwardauth

5. **IngressRoute for /oauth2/*** - Routes sign-in traffic to oauth2-proxy (unprotected)

6. **IngressRoute for /** - Protected route with middleware chain

**Why IngressRoute instead of HTTPRoute?**
- IngressRoute supports cross-namespace service references directly
- IngressRoute has native Middleware CRD integration
- Gateway API HTTPRoute + Middleware ExtensionRef has provider mismatch issues

**Why "web" entryPoint?**
- Cloudflare Tunnel terminates TLS and sends HTTP to Traefik
- Traffic arrives at the "web" (HTTP) entryPoint, not "websecure" (HTTPS)

</details>

## Architecture Decision: Per-Group Instances vs. Single Instance

**Decision**: One oauth2-proxy instance **per group**

**Rationale**:
1. **Isolation**: Each group has independent deployment, scaling, and lifecycle
2. **Security**: Unique cookie names prevent cross-group session sharing
3. **Flexibility**: Can restart one group without affecting others
4. **Monitoring**: Per-group metrics and logging

**Trade-off**: More resources (3-4 instances for 3-4 groups), but negligible for homelab:
- Each pod: ~30-50 MB RAM, <5m CPU
- Total overhead: ~100 MB + ConfigMaps/Services

## Configuration Reference

### Helm Chart Values (Pulumi)

```typescript
config: {
  existingSecret: "oauth2-proxy-github",  // Shared credentials
}

extraArgs: {
  provider: "github",                     // GitHub OAuth
  email-domain: "*",                      // Any email domain
  redirect-url: "https://oauth.{domain}/oauth2/callback",  // Callback URL
  whitelist-domain: ".{domain}",          // Allow subdomain redirects
  cookie-name: `_oauth2_${group}`,        // Unique per group
  cookie-domain: ".{domain}",             // Wildcard domain
  cookie-secure: "true",                  // HTTPS only
  cookie-httponly: "true",                // No JS access
  cookie-samesite: "lax",                 // CSRF protection
  cookie-expire: "168h",                  // 7 days
  cookie-refresh: "1h",                   // Hourly refresh
  set-xauthrequest: "true",              // Set auth headers
  reverse-proxy: "true",                  // Trust X-Forwarded-*
  pass-user-headers: "true",             // Pass headers to backend
}

authenticatedEmailsFile: {
  enabled: true,
  persistence: "configmap",              // Mount ConfigMap
  template: `oauth2-emails-${group}`,   // Reference ConfigMap
}

resources: {
  requests: { cpu: "10m", memory: "32Mi" },
  limits: { cpu: "100m", memory: "64Mi" },
}
```

### Pulumi Configuration

```bash
# Set GitHub OAuth App credentials
pulumi config set oauth2-proxy:clientId <client-id>
pulumi config set oauth2-proxy:clientSecret <secret> --secret
pulumi config set oauth2-proxy:cookieSecret <secret> --secret
```

Credentials are retrieved from `pulumi config` and stored as Kubernetes Secret.

## Traefik Integration Requirements

OAuth2-Proxy requires cross-namespace access. This requires:

```yaml
# In traefik-gateway/index.ts
providers:
  kubernetesCRD:
    enabled: true
    allowCrossNamespace: true  # ← CRITICAL: Enable cross-namespace references
    allowExternalNameServices: true  # ← For ExternalName services if used
```

## Request Flow: User Authentication

```
Browser Request → Cloudflare → Tunnel → Traefik (port 80/web)
  ├─ Match IngressRoute with oauth2-chain middleware
  ├─ Errors middleware wraps ForwardAuth
  ├─ ForwardAuth calls: http://oauth2-proxy-{group}/oauth2/auth
  │  └─ Forwards Cookie header from browser request
  │
  └─ oauth2-proxy checks:
     ├─ Is _oauth2_{group} cookie valid?
     │  ├─ NO → Return 401
     │  │  └─ Errors middleware serves redirect page
     │  │     └─ JS redirects to /oauth2/start?rd={original_url}
     │  │        └─ oauth2-proxy returns 302 to GitHub
     │  └─ YES → Check email in allowlist
     │
     ├─ Is email in oauth2-emails-{group} ConfigMap?
     │  ├─ YES → Return 200, set X-Auth-Request-* headers
     │  └─ NO → Return 403 Forbidden
     │
     └─ Backend receives request with auth headers
```

## Troubleshooting

### Redirect Loop After Authentication

**Symptom**: User authenticates on GitHub but keeps getting redirected back

**Cause**: ForwardAuth not forwarding Cookie header

**Fix**: Ensure middleware has `authRequestHeaders: ["Cookie", "Authorization"]`

### 401 with "Found" Link Instead of Auto-Redirect

**Symptom**: User sees HTML page with "Found" link instead of auto-redirect to GitHub

**Cause**: Missing redirect service for 401 handling

**Fix**: Ensure errors middleware + redirect service are configured (see example-route.ts)

### 404 on /oauth2/* Endpoints

**Symptom**: /oauth2/start or /oauth2/callback returns 404

**Cause**: Wrong entryPoint or missing IngressRoute

**Fix**: 
1. Ensure IngressRoute uses "web" entryPoint (Cloudflare terminates TLS)
2. Verify /oauth2/* IngressRoute exists and matches before protected route

### Users Can't Access After Email Change

**Symptom**: Email added to group but user still can't access

**Cause**: Pod hasn't restarted yet

**Fix**:
```bash
# Option 1: Wait for automatic restart (checksum annotation triggers it)
kubectl get pods -n oauth2-proxy -w

# Option 2: Force restart
kubectl rollout restart deployment/oauth2-proxy-users -n oauth2-proxy
```

## Related Files

- `packages/core/infrastructure/src/traefik-gateway/index.ts` - Traefik configuration
- `packages/core/infrastructure/src/index.ts` - Infrastructure exports
- `docs/OAUTH2_PROXY.md` - User-facing documentation
- `docs/OAUTH2_PROXY_EXAMPLES.md` - Usage examples
