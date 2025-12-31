# ADR 011: Centralized Authentication Stack with Forward Auth

**Status:** Proposed
**Date:** 2025-12-31
**Deciders:** Project maintainers

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

**Deploy Authelia with forward authentication pattern at ingress level.**

Authelia acts as centralized identity provider and authentication proxy, protecting all applications via nginx ingress annotations. GitHub and Google OAuth federated as authentication sources.

### Architecture

```
Internet → Cloudflare Tunnel → ingress-nginx (forward-auth) → Authelia
                                        ↓
                    ┌───────────────────┴─────────────────┐
                    ↓                   ↓                 ↓
                 Supabase          Custom Apps        OSS Apps
                 (OIDC)         (forward-auth)    (forward-auth)
```

**Authentication Flow:**
1. User accesses `app.domain.com`
2. ingress-nginx forwards auth check to Authelia
3. If unauthenticated: redirect to `auth.domain.com`
4. User logs in via GitHub/Google (federated)
5. Authelia creates session, applies access policy
6. User redirected back to original app with auth headers

**Forward Auth Pattern:**
```yaml
# Applied to all Ingress resources
nginx.ingress.kubernetes.io/auth-url: "https://auth.domain.com/api/verify"
nginx.ingress.kubernetes.io/auth-signin: "https://auth.domain.com"
nginx.ingress.kubernetes.io/auth-response-headers: "Remote-User,Remote-Email,Remote-Groups"
```

## Rationale

### Why Authelia?

1. **OIDC Provider Capability**
   - Provides OIDC endpoints for Supabase integration
   - Can act as identity provider for any OIDC-compatible application
   - Supports custom claim mapping (email, groups, roles)

2. **Forward Authentication Native**
   - Designed specifically for nginx/Traefik forward-auth pattern
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

## Implementation Strategy

### Phase 1: Core Authelia Deployment (2-3 hours)

**1.1 Create Authelia Pulumi Component**
```typescript
// packages/core/infrastructure/src/auth/authelia.ts
- Deploy Authelia Helm chart
- Configure Redis/PostgreSQL backend for sessions
- Set up GitHub/Google OAuth federation
- Create ClusterSecretStore integration for credentials
```

**1.2 Deploy Authelia Service**
```typescript
- Namespace: auth-system
- Storage: PostgreSQL on Longhorn PVC (session data)
- Ingress: auth.{domain} (Cloudflare Tunnel + cert-manager)
- Configuration: ConfigMap managed by Pulumi
```

**1.3 Configure OAuth Providers**
```bash
# GitHub OAuth App
- Homepage URL: https://auth.{domain}
- Callback URL: https://auth.{domain}/api/oidc/callback

# Google OAuth Client
- Authorized redirect URIs: https://auth.{domain}/api/oidc/callback
```

### Phase 2: Update ExposedWebApp Component (1-2 hours)

**2.1 Add Forward-Auth Option**
```typescript
interface ExposedWebAppArgs {
  requireAuth?: boolean | {
    policy?: "bypass" | "one_factor" | "two_factor"
    allowedUsers?: string[]
    allowedGroups?: string[]
  }
  // Deprecated: Remove oauth sidecar support
  oauth?: never
}
```

**2.2 Apply Ingress Annotations**
```typescript
if (args.requireAuth) {
  ingress.metadata.annotations = {
    ...ingress.metadata.annotations,
    "nginx.ingress.kubernetes.io/auth-url": authConfig.verifyUrl,
    "nginx.ingress.kubernetes.io/auth-signin": authConfig.signinUrl,
    "nginx.ingress.kubernetes.io/auth-response-headers": "Remote-User,Remote-Email,Remote-Groups",
  }
}
```

### Phase 3: Supabase OIDC Integration (1 hour)

**3.1 Configure Authelia as OIDC Provider**
```yaml
# Authelia configuration
identity_providers:
  oidc:
    clients:
      - id: supabase
        description: Supabase Authentication
        secret: ${SUPABASE_OIDC_SECRET}
        redirect_uris:
          - https://supabase.{domain}/auth/v1/callback
        scopes:
          - openid
          - email
          - profile
```

**3.2 Configure Supabase**
```env
# Supabase .env
GOTRUE_EXTERNAL_AUTHELIA_ENABLED=true
GOTRUE_EXTERNAL_AUTHELIA_CLIENT_ID=supabase
GOTRUE_EXTERNAL_AUTHELIA_SECRET=***
GOTRUE_EXTERNAL_AUTHELIA_URL=https://auth.{domain}
```

### Phase 4: Access Policies (30 minutes)

**4.1 Define Access Rules**
```yaml
# Authelia ACL configuration
access_control:
  default_policy: deny
  rules:
    # Public apps
    - domain: "hello-world.{domain}"
      policy: one_factor

    # Admin apps (MFA required)
    - domain: "longhorn.{domain}"
      policy: two_factor
      subject:
        - "user:admin@example.com"

    # Team apps
    - domain: "*.{domain}"
      policy: one_factor
      subject:
        - "group:homelab-users"
```

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

## Migration Plan

### Week 1: Infrastructure Setup
- [ ] Deploy Authelia via Pulumi
- [ ] Configure PostgreSQL session backend
- [ ] Set up GitHub/Google OAuth federation
- [ ] Create `auth.{domain}` ingress with TLS
- [ ] Validate Authelia login flow works

### Week 2: Component Refactor
- [ ] Update ExposedWebApp component with `requireAuth` option
- [ ] Remove oauth2-proxy sidecar code
- [ ] Add forward-auth annotation logic
- [ ] Create access policy configuration patterns
- [ ] Update documentation and examples

### Week 3: Application Migration
- [ ] Migrate hello-world app (test case)
- [ ] Migrate Longhorn UI with MFA policy
- [ ] Migrate remaining OSS apps
- [ ] Validate SSO working across apps
- [ ] Remove old OAuth secrets from Pulumi ESC

### Week 4: Supabase Integration
- [ ] Deploy Supabase stack
- [ ] Configure Authelia OIDC client
- [ ] Configure Supabase OIDC provider
- [ ] Test end-to-end authentication flow
- [ ] Document Supabase setup procedure

## Success Criteria

- [ ] Authelia deployed and accessible at `auth.{domain}`
- [ ] GitHub/Google authentication working
- [ ] At least 3 apps protected with forward-auth
- [ ] SSO verified (login once, access all apps)
- [ ] Per-app access policies functional
- [ ] Supabase OIDC integration complete
- [ ] MFA working for admin apps
- [ ] Old oauth2-proxy sidecars removed
- [ ] Documentation updated
- [ ] Zero increase in authentication failures

## Follow-up Actions

### Immediate (Post-Implementation)
1. Set up monitoring and alerting for Authelia availability
2. Document ACL policy patterns for common scenarios
3. Create user onboarding procedure (GitHub/Google account setup)
4. Implement Authelia session backup to R2

### Short-Term (1-3 months)
1. Add local user backend as fallback for external IdP outages
2. Implement MFA enforcement for all users
3. Set up authentication metrics dashboard
4. Create disaster recovery runbook

### Long-Term (3-6 months)
1. Evaluate migration to Authentik if UI management becomes priority
2. Add additional identity providers (Microsoft, generic OIDC)
3. Implement group synchronization from GitHub organizations
4. Consider hardware security key support (WebAuthn)

## References

- [Authelia Documentation](https://www.authelia.com/overview/prologue/introduction/)
- [Authelia Forward Auth](https://www.authelia.com/integration/proxies/nginx/)
- [Authelia OIDC Provider](https://www.authelia.com/configuration/identity-providers/oidc/)
- [Supabase External OAuth](https://supabase.com/docs/guides/auth/social-login)
- [nginx Ingress Auth](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/#external-authentication)
- [ADR 004: Component Pattern](./004-component-pattern.md)
- [ADR 008: Secrets Management](./008-secrets-management.md)
