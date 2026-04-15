# Development Plan: Configurable OAuth Scopes — developers group

*Branch: `claude/configurable-oauth-scopes-9RhZu`*

## Goal

Add a `developers` group to the oauth2-proxy configuration with GitHub OAuth scopes covering typical dev workflows. A consumer authenticating via this group receives an access token with permissions to create repos, manage issues/PRs, read org membership, update Actions workflows, and manage gists.

Scopes for `developers`: `["user:email", "repo", "read:org", "workflow", "gist"]`

See **ADR 014** (`docs/adr/014-oauth-callback-routing-strategy.md`) for the decision on how the shared callback URL routes to the correct oauth2-proxy instance.

## Architecture

All groups share `oauth.{domain}/oauth2/callback` as the single GitHub OAuth callback URL. A Traefik **IngressRoute** routes each callback request to the correct oauth2-proxy instance by matching the CSRF cookie (`_oauth2_{group}_{hash}_csrf`) present in the `Cookie` request header using `HeaderRegexp`. More specific rules (higher `priority`) are listed before the default fallback rule.

> Note: Traefik v3.1 does not support `RegularExpression` header matching in Gateway API HTTPRoutes. The Traefik-native IngressRoute CRD with `HeaderRegexp()` is used instead. Also, `cookie-csrf-per-request=true` causes oauth2-proxy to embed a per-request state hash in the CSRF cookie name, so the regex must be `.*_oauth2_{group}_.*_csrf.*`.

`callbackSubdomain` is **not** part of `GroupConfig` — callback routing is an infrastructure concern internal to `callback-route.ts`.

`ExposedWebApp.ts` — **no changes needed**.

## Changes Required

### 1. `groups.ts` — replace type, add `developers` entry

`GroupConfig` has `emails` and optional `scopes`. No `callbackSubdomain`.

```typescript
export interface GroupConfig {
  emails: string[];
  /** GitHub OAuth scopes. Omit to use oauth2-proxy default (user:email). */
  scopes?: string[];
}

export const groups: Record<string, GroupConfig> = {
  users: {
    emails: ["github@beimir.net", "dirk.oberhaus@gmx.de"],
  },
  developers: {
    emails: ["github@beimir.net"],
    scopes: ["user:email", "repo", "read:org", "workflow", "gist"],
  },
};
```

### 2. `helpers.ts` — simplify `buildHelmExtraArgs`

`redirect-url` always points to the shared callback. Conditional scope arg when `scopes` is set.

```typescript
export function buildHelmExtraArgs(
  group: string,
  config: GroupConfig,
  domain: string
): Record<string, string> {
  const args: Record<string, string> = {
    provider: "github",
    "redirect-url": `https://oauth.${domain}/oauth2/callback`,
    // ... other static args
  };
  if (config.scopes && config.scopes.length > 0) {
    args["scope"] = config.scopes.join(" ");
  }
  return args;
}
```

### 3. `email-configmaps.ts` — fix destructuring (`config.emails`)

Already done. No further change.

### 4. `oauth2-proxy.ts` — use helpers

Already done. No further change.

### 5. `callback-route.ts` — cookie-based routing

Replace the current single-rule HTTPRoute with a Traefik IngressRoute with multiple rules. Non-default groups get a `HeaderRegexp` cookie-match rule; the default group is the fallback.

```
routes:
  [for each group with scopes]:
    match: Host + PathPrefix(/oauth2/callback) + HeaderRegexp(Cookie, .*_oauth2_{group}_.*_csrf.*)
    priority: 20
    backend: oauth2-proxy-{group}
  [fallback — first group / users]:
    match: Host + PathPrefix(/oauth2/callback)
    priority: 10
    backend: oauth2-proxy-users
```

Rule priority is explicit; higher value wins.

## Test Changes (red → green cycle)

### Remove from `groups.test.ts`:
- `callbackSubdomain`-related tests (removed — field never existed)

### Remove from `helpers.test.ts`:
- `uses group-specific redirect-url when callbackSubdomain is set` (removed — no subdomain routing)

### Update in `helpers.test.ts`:
- `uses shared redirect-url` — this is now the only case; test still passes with simplified implementation

## Files to Change

| File | Change |
|---|---|
| `packages/core/infrastructure/src/oauth2-proxy/groups.ts` | Add `GroupConfig` interface with optional `scopes`; add `developers` entry |
| `packages/core/infrastructure/src/oauth2-proxy/helpers.ts` | Simplify `buildHelmExtraArgs` — always shared redirect-url; add conditional `scope` arg |
| `packages/core/infrastructure/src/oauth2-proxy/callback-route.ts` | Cookie-based multi-rule Traefik IngressRoute (replaces single-rule HTTPRoute) |
| `packages/core/infrastructure/src/oauth2-proxy/oauth2-proxy.ts` | Add explicit `name` to Helm releases for predictable service names |
| `packages/core/infrastructure/src/oauth2-proxy/groups.test.ts` | Add tests for new `developers` group and `GroupConfig` interface |
| `packages/core/infrastructure/src/oauth2-proxy/helpers.test.ts` | Add tests for scoped `buildHelmExtraArgs` |
| `docs/adr/014-oauth-callback-routing-strategy.md` | New — documents the routing decision |

## Backward Compatibility

- The `users` group has no `scopes` → its Helm release, ConfigMap, and fallback callback rule are unchanged
- The shared `oauth.{domain}/oauth2/callback` DNS record is preserved; the callback handler changes from HTTPRoute to IngressRoute

## GitHub OAuth App

No changes required. The single registered callback URL (`https://oauth.{domain}/oauth2/callback`) remains valid for all groups.

## Verification

1. `npm test` in `packages/core/infrastructure` → all tests green
2. `npm run type-check` in `packages/core/infrastructure` → no errors
3. `pulumi preview` → shows updated IngressRoute with `HeaderRegexp` cookie-match rules; no new DNS records
4. After `pulumi up`: visiting an app in the `developers` group → GitHub consent shows the additional scopes
5. `oauth2-proxy-users` Helm release args unchanged
