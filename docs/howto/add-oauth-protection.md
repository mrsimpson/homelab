# How to Add OAuth Protection

## Goal

Require GitHub authentication before users can access a web app, using the centralized oauth2-proxy deployment.

## Prerequisites

- App already deployed via `ExposedWebApp` (see [expose-web-app.md](expose-web-app.md))
- User's email added to an oauth2-proxy group (see [manage-access-control.md](manage-access-control.md))

## How It Works

Authentication uses a **centralized oauth2-proxy** deployment (in namespace `oauth2-proxy`) shared across all apps. No per-app OAuth application or sidecar is needed.

```
Browser → Cloudflare → Traefik → IngressRoute (chain middleware)
  │
  ├─ ForwardAuth middleware → oauth2-proxy /oauth2/auth
  │   └─ Checks session cookie (Cookie header forwarded)
  │
  ├─ Valid session → proxy to app backend
  │   └─ X-Auth-Request-Email header set for the app
  │
  └─ No/invalid session → 401
      └─ Errors middleware → shared redirect service
          └─ Redirects to GitHub OAuth → callback → cookie set → back to app
```

ExposedWebApp creates the full middleware chain automatically when you set `auth: AuthType.OAUTH2_PROXY`.

## Steps

### 1. Add Auth to Your App

```typescript
import { homelabConfig } from "@mrsimpson/homelab-config";
import { AuthType, type HomelabContext } from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

export function createMyApp(homelab: HomelabContext) {
  const domain = pulumi.interpolate`my-app.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp("my-app", {
    image: "my-image:latest",
    domain,
    port: 8080,
    auth: AuthType.OAUTH2_PROXY,
    oauth2Proxy: { group: "users" },  // optional, defaults to "users"
  });

  return { app, url: pulumi.interpolate`https://${domain}` };
}
```

### 2. Ensure User Has Access

Users must be in the oauth2-proxy group's email allowlist:

```typescript
// packages/core/infrastructure/src/oauth2-proxy/groups.ts
export const groups: Record<string, string[]> = {
  users: [
    "alice@example.com",
    "bob@example.com",
  ],
};
```

See [OAUTH2_PROXY_EXAMPLES.md](../OAUTH2_PROXY_EXAMPLES.md) for step-by-step examples.

### 3. Deploy

```bash
pulumi up
```

### 4. Verify

1. Visit `https://my-app.yourdomain.com`
2. You should be redirected to GitHub for sign-in
3. After authentication, you're redirected back to your app
4. If your email isn't in the group: 403 Forbidden

## What Gets Created

When `auth: AuthType.OAUTH2_PROXY` is set, ExposedWebApp creates **IngressRoutes** (Traefik CRD) instead of HTTPRoutes (Gateway API), plus three middlewares:

| Resource | Name | Purpose |
|---|---|---|
| Middleware | `<app>-oauth2-forwardauth` | ForwardAuth check against oauth2-proxy |
| Middleware | `<app>-oauth2-errors` | Catches 401 → redirect via shared service |
| Middleware | `<app>-oauth2-chain` | Chains errors + forwardauth |
| IngressRoute | `<app>-oauth2-signin` | `/oauth2/*` → oauth2-proxy (unprotected) |
| IngressRoute | `<app>-oauth2-app` | `/*` → app (protected by chain) |

## Reading the Authenticated User

After authentication, oauth2-proxy sets headers on requests forwarded to your app:

| Header | Value |
|---|---|
| `X-Auth-Request-Email` | User's email (e.g. `alice@example.com`) |
| `X-Auth-Request-User` | Username |
| `X-Auth-Request-Groups` | Groups the user belongs to |

Your application code can read these headers to identify the user without implementing its own auth.

## Adding Extra Routes with the Same Auth

If your app needs additional IngressRoutes (e.g. wildcard subdomain routes), you can reference the chain middleware by its deterministic name to share the same auth flow:

```typescript
new k8s.apiextensions.CustomResource("my-extra-route", {
  apiVersion: "traefik.io/v1alpha1",
  kind: "IngressRoute",
  metadata: { name: "my-extra-route", namespace: "my-app" },
  spec: {
    entryPoints: ["web"],
    routes: [{
      match: `HostRegexp(\`{sub:[a-z]+}.my-app.example.com\`)`,
      kind: "Rule",
      middlewares: [{
        name: "my-app-oauth2-chain",   // deterministic: <name>-oauth2-chain
        namespace: "my-app",
      }],
      services: [{ name: "my-app", port: 80 }],
    }],
  },
}, { dependsOn: app.route });  // ensure middleware exists first
```

## Comparing Auth Modes

| | `AuthType.NONE` | `AuthType.FORWARD` | `AuthType.OAUTH2_PROXY` |
|---|---|---|---|
| Route type | HTTPRoute | HTTPRoute | IngressRoute |
| Auth provider | None | Authelia (local accounts) | GitHub OAuth |
| Setup required | Nothing | Authelia policies | Email in group allowlist |
| Use case | Public apps | Internal users, MFA | External developers, GitHub SSO |

## Troubleshooting

### Redirect Loop

```bash
kubectl logs -n oauth2-proxy deployment/oauth2-proxy-users
```

Common causes: cookie domain mismatch, Cloudflare caching interfering with auth cookies.

### 403 After Successful Login

The user's email isn't in the group allowlist. Check:

```bash
kubectl get configmap -n oauth2-proxy oauth2-emails-users -o yaml
```

Add the email to `groups.ts` and run `pulumi up`.

### 401 but User is Logged In

The session cookie may have expired or the ForwardAuth middleware can't reach oauth2-proxy:

```bash
kubectl logs -n my-app -l app=my-app  # check for upstream errors
kubectl get endpoints -n oauth2-proxy oauth2-proxy-users  # verify service has endpoints
```

## Next Steps

- [Manage Access Control](manage-access-control.md) — add/remove users and groups
- [OAuth2-Proxy Guide](../OAUTH2_PROXY.md) — full architecture and configuration details
- [OAuth2-Proxy Examples](../OAUTH2_PROXY_EXAMPLES.md) — step-by-step recipes
