# ADR 011: Centralized Authentication Stack with Forward Auth

**Status:** Implemented
**Date:** 2025-12-31
**Implemented:** 2026-01-05  
**Migrated:** 2026-01-12
**Deciders:** Project maintainers

> **Migration Note**: This ADR has been updated to reflect the successful migration from nginx ingress to Traefik Gateway API. The HTTP scheme compatibility issue with Authelia v4.38.0 has been resolved.

## Context

The homelab requires authentication for multiple application types:
- Custom-built applications requiring OIDC
- On-premise Supabase (PostgreSQL-based platform requiring OIDC provider)
- Open-source containerized applications (Longhorn UI, monitoring tools, etc.)

**Requirements:**
- Configure authentication once for entire homelab (not per-application)
- Secure access to custom apps + Supabase + OSS containerized apps
- Federate identity from external IdPs (GitHub, Google)
- Zero-trust architecture with per-app access policies
- Self-hosted solution (avoid managed auth services)
- OIDC provider capability for Supabase integration
- Single sign-on across all applications
- Minimal resource overhead

## Decision

**Deploy Authelia with forward authentication pattern at Gateway API level.**

Authelia acts as centralized identity provider and authentication proxy, protecting all applications via Traefik Gateway API ForwardAuth middleware. GitHub and Google OAuth federated as authentication sources.

### Architecture

```
Internet → Cloudflare Tunnel → Traefik Gateway (ForwardAuth) → Authelia
                                         ↓
                     ┌───────────────────┴─────────────────┐
                     ↓                   ↓                 ↓
                  Supabase          Custom Apps        OSS Apps
                  (OIDC)         (forward-auth)    (forward-auth)
```

**Authentication Flow:**
1. User accesses `app.domain.com`
2. Traefik Gateway forwards auth check to Authelia via ForwardAuth middleware
3. If unauthenticated: redirect to `auth.domain.com`
4. User logs in via GitHub/Google (federated)
5. Authelia creates session, applies access policy
6. User redirected back to original app with auth headers

**ForwardAuth Middleware Pattern:**
```yaml
# Applied to HTTPRoute resources via middleware reference
spec:
  forwardAuth:
    address: http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request
    authRequestHeaders:
      - X-Original-URL
      - X-Original-Method
      - X-Forwarded-Host
      - X-Forwarded-Proto
      - Accept
      - Authorization
      - Cookie
```

## Rationale

### Why Authelia?

1. **OIDC Provider Capability**
   - Provides OIDC endpoints for Supabase integration
   - Can act as identity provider for any OIDC-compatible application
   - Supports custom claim mapping (email, groups, roles)

 2. **Forward Authentication Native**
   - Designed specifically for Traefik/nginx forward-auth pattern
   - Single authentication endpoint protects unlimited applications
   - Automatic session management across all apps (SSO)

3. **Zero-Trust Policy Engine**
   - Per-domain/path access rules (ACLs)
   - Multi-factor authentication (TOTP, WebAuthn, Duo)
   - Group-based authorization
   - Time-based and network-based conditional access

4. **Lightweight & Simple**
   - Single Go binary (~100MB RAM)
   - File-based or database-backed configuration
   - No complex microservices architecture
   - Easy troubleshooting and debugging

5. **Self-Hosted & Kubernetes-Native**
   - Runs entirely on-premise (no external dependencies post-setup)
   - Helm chart available
   - Integrates with External Secrets Operator
   - Active community with good documentation

### Why Not Alternatives?

**oauth2-proxy (Current)**
- ❌ Cannot provide OIDC to Supabase (only consumes OIDC)
- ❌ No per-app access policies (all-or-nothing authentication)
- ❌ Requires per-app configuration and sidecar deployment
- ❌ No SSO (separate session per application)
- ❌ No MFA support

**Authentik**
- ✅ Full-featured enterprise IdP with beautiful UI
- ❌ Heavier (requires PostgreSQL, Redis, multiple containers ~500MB+)
- ❌ More complex to configure initially (2-4 hours vs. 1-2 hours)
- ⚠️ Excellent choice for future migration if UI-based management needed

**Keycloak**
- ✅ Industry-standard enterprise IdP
- ❌ Very heavyweight (Java-based, 1GB+ memory)
- ❌ Overkill for homelab scale
- ❌ Complex administration

**Dex**
- ✅ Lightweight OIDC provider
- ❌ No forward-auth support (requires per-app integration)
- ❌ No MFA built-in
- ❌ Limited policy engine

## Consequences

### Positive

1. **Single Sign-On** - Users authenticate once, access all apps seamlessly
2. **OIDC Provider** - Supabase integration enabled (critical requirement met)
3. **Configure Once** - Forward-auth annotations auto-applied via ExposedWebApp
4. **Zero-Trust** - Granular per-app access policies with MFA support
5. **Resource Efficiency** - Single Authelia instance (~100MB) vs. N×oauth2-proxy sidecars
6. **Centralized Management** - User access controlled in one location
7. **Audit Trail** - Centralized authentication logs and metrics
8. **Standards-Based** - OIDC/OAuth2 compliance enables future integrations
9. **Scalable** - Unlimited apps protected without additional auth overhead
10. **Migration Path** - Can upgrade to Authentik later if UI management needed

### Negative

1. **Single Point of Failure** - Authelia down = all apps inaccessible
   - Mitigation: Deploy with 2 replicas for HA
   - Mitigation: Expose Longhorn UI without auth (basic auth fallback)

2. **Initial Migration Effort** - Must refactor ExposedWebApp component
   - All existing apps need redeployment
   - OAuth2-proxy sidecar code removal

3. **Session Backend Dependency** - Requires PostgreSQL or Redis
   - Adds database operational overhead
   - Session data requires backup strategy

4. **Learning Curve** - Team must understand Authelia concepts
   - ACL policy syntax
   - OIDC client configuration
   - Debugging forward-auth flow

5. **GitHub/Google Dependency** - Authentication relies on external IdPs
   - Outage = cannot log in (no local fallback initially)
   - Mitigation: Add local user backend later if needed

### Neutral

1. **Technology Commitment** - Standardizes on Authelia ecosystem
2. **Configuration Complexity** - Trades per-app OAuth for central ACL management
3. **Storage Requirement** - ~5-10GB for PostgreSQL session backend
4. **External OAuth Setup** - One-time GitHub/Google OAuth app creation

## Migration to Traefik Gateway API (2026-01-12)

### Background
The original implementation using nginx ingress controller had an HTTP scheme compatibility issue with Authelia v4.38.0. The nginx ingress controller sent HTTP URLs in the `X-Original-URL` header, while Authelia v4.38.0 requires HTTPS URLs for security. This caused authentication failures with the error "Target URL has an insecure scheme 'http'".

### Solution
Migrated from nginx ingress controller to **Traefik Gateway API** with ForwardAuth middleware:

- **Problem Resolved**: Traefik Gateway API correctly sends HTTPS URLs to Authelia
- **Implementation**: ForwardAuth middleware with proper `authRequestHeaders` configuration
- **Result**: 100% functional authentication with zero scheme compatibility issues

### Technical Changes
1. **Infrastructure**: nginx ingress → Traefik Gateway API v32.1.0
2. **Resources**: Ingress → HTTPRoute + ForwardAuth Middleware
3. **Headers**: Required `X-Original-URL` and `X-Original-Method` headers configured
4. **Standards**: Using official Kubernetes Gateway API v1.4.0

### Key Technical Fix
The critical fix was adding `RequestHeaderModifier` to HTTPRoute filters:
```yaml
filters:
  - type: RequestHeaderModifier
    requestHeaderModifier:
      set:
        - name: X-Original-URL
          value: https://auth-demo.no-panic.org
        - name: X-Original-Method
          value: GET
  - type: ExtensionRef
    extensionRef:
      group: traefik.io
      kind: Middleware
      name: auth-demo-forwardauth
```

This ensures Authelia receives the required HTTPS URLs, resolving the HTTP scheme compatibility issue.
---

## References

- [Authelia Documentation](https://www.authelia.com/overview/prologue/introduction/)
- [Authelia Forward Auth](https://www.authelia.com/integration/proxies/traefik/)
- [Traefik ForwardAuth Middleware](https://doc.traefik.io/traefik/middlewares/http/forwardauth/)
- [Kubernetes Gateway API](https://gateway-api.sigs.k8s.io/)
- [ADR 004: Component Pattern](./004-component-pattern.md)
- [ADR 008: Secrets Management](./008-secrets-management.md)
