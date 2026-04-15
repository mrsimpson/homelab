# ADR 014: OAuth Callback Routing via CSRF Cookie Header Matching

## Status

Accepted (amended — implementation changed from HTTPRoute to IngressRoute)

## Context

The homelab authentication stack deploys one oauth2-proxy instance per group, where each group may request different GitHub OAuth scopes. Applications requiring elevated GitHub API access (e.g. repo management, Actions workflows) belong to a group with broader scopes; general applications belong to a default group with minimal scopes.

Each oauth2-proxy instance names its CSRF cookie after its group: `_oauth2_{group}_csrf`. This cookie is set when the OAuth flow starts and must be validated by the same instance when GitHub redirects back to the callback URL. If a different instance handles the callback, CSRF validation fails and the login flow is rejected.

This creates a routing problem: all instances share a single GitHub OAuth App, which only supports one registered callback URL. The callback endpoint must therefore be shared, but requests must be forwarded to the instance that initiated the specific flow.

Three approaches were considered:

1. **Separate GitHub OAuth App per group** — each group gets its own client-id/secret pair, allowing each its own callback URL. Operational overhead grows linearly with the number of groups.
2. **GitHub App (not OAuth App)** — supports up to 10 callback URLs with a single credential pair, but requires migrating the app type and updating the Kubernetes secret.
3. **Cookie-based routing at the shared callback** — a single callback URL is retained; a Traefik IngressRoute with `HeaderRegexp` routes requests to the correct instance by matching the CSRF cookie present in the `Cookie` request header.

## Decision

We will route the shared OAuth callback (`oauth.{domain}/oauth2/callback`) to the correct oauth2-proxy instance using a Traefik **IngressRoute** (CRD) with `HeaderRegexp` cookie matching.

> **Note:** Traefik v3.1 does not implement the `RegularExpression` header match type for Gateway API `HTTPRoute` (an extended feature it skips). The Traefik-native `IngressRoute` CRD with `HeaderRegexp()` in the router rule DSL must be used instead.

Each non-default group gets a dedicated routing rule that matches the regular expression `.*_oauth2_{group}_.*_csrf.*` against the `Cookie` header. The `.*` between the group name and `_csrf` is required because `cookie-csrf-per-request=true` causes oauth2-proxy to embed a per-request state hash in the cookie name (`_oauth2_{group}_{hash}_csrf`). Rules are ordered by explicit `priority`; the default group acts as the fallback with the lowest priority. No additional callback URLs, DNS records, or GitHub App credentials are required.

The `GroupConfig` type exposes `scopes` for configuring OAuth scope sets. It does not expose a `callbackSubdomain` field; callback routing is an infrastructure concern managed entirely within `callback-route.ts`.

## Consequences

### Positive

- Single GitHub OAuth App credential pair regardless of how many groups are defined
- No DNS record or certificate provisioning required per group
- The GitHub OAuth App configuration does not change when groups are added or removed
- Routing logic is centralized in one resource and co-located with existing callback infrastructure

### Negative

- If a user simultaneously has active login flows for two different groups in the same browser (both mid-redirect, neither yet completed), the cookie-match routing may forward the completing callback to the wrong instance, causing CSRF failure
- Routing relies on the `_oauth2_{group}_{hash}_csrf` cookie naming convention of oauth2-proxy with `cookie-csrf-per-request=true`; a change to that convention would silently break routing

### Neutral

- Rule ordering by `priority` is significant; higher priority rules are evaluated first
- Adding a new group requires a new IngressRoute rule with a priority higher than the fallback
- The edge case of simultaneous cross-group flows is not mitigated; it is accepted as negligible in a homelab context with a small, known user base
- The `_oauth2_{group}_{hash}_csrf` cookie naming convention is an implementation detail of oauth2-proxy with `cookie-csrf-per-request=true`; the regex must account for the hash segment
