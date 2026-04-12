# Development Plan: opencode-router ExposedWebApp Integration

*2026-04-11*

## Goal

Refactor the `opencode-router` deployment (572 lines, ~15 manually created K8s resources) to use the `ExposedWebApp` component pattern, eliminating duplicated OAuth2-proxy wiring, DNS setup, and ExternalSecret management.

---

## Key Decisions

### The router IS the ExposedWebApp

The original deployment (`development-plan-opencode-router.md`) chose **not** to use ExposedWebApp because the router needed RBAC, custom secrets, and wildcard subdomain routing that the component didn't support. On re-evaluation, these are **supplementary** resources that sit alongside ExposedWebApp, not replacements for it. The router itself — a container with a Deployment, Service, OAuth2-Proxy auth, DNS, and pull secret — is exactly what ExposedWebApp exists for.

The per-user pods stay **internal-only** (ClusterIP pod IPs). The router reverse-proxies to them. No per-pod routes, DNS, or auth resources needed.

```
Internet → Cloudflare Tunnel → Traefik → ExposedWebApp(router) [OAuth] → Router → Pod IP
                                       → Wildcard IngressRoute [same OAuth] → Router → Pod IP
```

### ExposedWebApp extended with general-purpose fields

Two missing capabilities were needed, both generally useful (not router-specific):

- **`serviceAccountName`** — sets the pod's ServiceAccount. The router needs this to manage user pods via the K8s API. Any app with RBAC requirements benefits.
- **`probes`** — readiness/liveness probes for the main container. Previously impossible to configure through ExposedWebApp.
- **`namespace` exposed as public property** — needed for dependency wiring when the caller creates app-specific resources in the same namespace.

### Wildcard IngressRoute reuses OAuth2-Proxy chain middleware by name

Session subdomains (`<hash>.opencode-router.<domain>`) need the same OAuth protection as the main domain. ExposedWebApp creates middlewares with deterministic names: `<name>-oauth2-forwardauth`, `<name>-oauth2-errors`, `<name>-oauth2-chain`. The wildcard IngressRoute references `opencode-router-oauth2-chain` directly, avoiding middleware duplication. This naming contract is now documented in the ExposedWebApp JSDoc.

### Resources eliminated vs. retained

**Eliminated (9)** — now handled by ExposedWebApp:
- Deployment, Service, GHCR ExternalSecret
- ForwardAuth + Errors + Chain Middlewares (3)
- OAuth2 Sign-in + App IngressRoutes (2)
- Main DNS CNAME record

**Retained (8)** — app-specific, can't be abstracted:
- Namespace (pre-created with `restricted` PSS, passed to ExposedWebApp)
- ServiceAccount, Role, RoleBinding (RBAC for runtime pod management)
- Secret (Anthropic API key), ConfigMap (opencode.json)
- Wildcard IngressRoute (session subdomains)
- Wildcard Cloudflare DNS record

Result: **572 → 268 lines** (-53%).

### Authorization gap identified (upstream fix needed)

During analysis, a cross-user authorization gap was found in the router application code (not this repo):

- The router **authenticates** users via `X-Auth-Request-Email` (from oauth2-proxy)
- But it does **not authorize** session access — any authenticated user can access any session subdomain
- The session hash is deterministic (`SHA-256(email + repo + branch)` → first 12 hex chars), so if user B knows user A's email + repo + branch, they can compute the hash
- Fix belongs in `mrsimpson/opencode` repo: check the pod's `user-email` annotation against the requesting user's email before proxying

This does not block the integration (single-user homelab), but is a prerequisite for secure multi-user operation.

---

## Research

### How ExposedWebApp handles OAuth2-Proxy auth

Traced the full middleware chain in `ExposedWebApp.ts`:

1. **ForwardAuth middleware** — calls `http://oauth2-proxy-<group>.<ns>.svc.cluster.local/oauth2/auth`, forwards `Cookie` + `Authorization` headers, returns `X-Auth-Request-Email/User/Groups` + `Set-Cookie`
2. **Errors middleware** — catches HTTP 401, serves redirect page from shared `oauth2-shared-redirect` service in `oauth2-proxy` namespace
3. **Chain middleware** — chains errors → forwardauth (order matters: errors wraps forwardauth)
4. **Sign-in IngressRoute** — `Host + PathPrefix(/oauth2/)` → oauth2-proxy service (unprotected)
5. **App IngressRoute** — `Host` → app service (protected by chain, priority 1)

All use `entryPoints: ["web"]` because Cloudflare terminates TLS.

### Per-user pod routing

The router reads the `Host` header to extract the 12-char hex hash from session subdomains. It looks up the pod IP from an in-memory cache (backed by K8s pod list) and proxies directly to `http://<pod-ip>:4096`. WebSocket upgrade is handled transparently by the Node.js `http-proxy` library.

### Existing docs that needed updating

- `docs/howto/expose-web-app.md` — described wrong API (`new ExposedWebApp(...)` instead of `homelab.createExposedWebApp(...)`) and mentioned ingress-nginx instead of Traefik/Gateway API
- `docs/howto/add-oauth-protection.md` — described a per-app OAuth sidecar pattern that was replaced by centralized oauth2-proxy with `AuthType.OAUTH2_PROXY`
- `ExposedWebApp.ts` JSDoc — missing documentation for `serviceAccountName`, `probes`, and the OAuth2-Proxy middleware naming contract

All updated as part of this work.

---

## Implementation

### Files changed

| File | Change |
|---|---|
| `packages/core/components/src/ExposedWebApp.ts` | Added `serviceAccountName`, `probes` to interface + constructor; exposed `namespace` property; documented OAuth2-Proxy naming contract in JSDoc |
| `packages/apps/opencode-router/src/index.ts` | Refactored from 572 to 268 lines; uses `homelab.createExposedWebApp()` |
| `packages/apps/opencode-router/README.md` | New: intent, architecture, image dependency, config vars |
| `docs/howto/expose-web-app.md` | Rewritten for current `HomelabContext` + `ExposedWebApp` API |
| `docs/howto/add-oauth-protection.md` | Rewritten for centralized oauth2-proxy pattern |

### Verification

- `npx tsc --noEmit` — clean, zero errors
- Effective K8s resources unchanged: same Deployment env vars, same OAuth middleware chain, same IngressRoutes (main + wildcard), same DNS records
