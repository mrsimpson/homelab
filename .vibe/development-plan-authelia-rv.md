# Development Plan: homelab (authelia-rv branch)

*Generated on 2026-01-07 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal
Add proper authentication to the homelab stack, exploring options beyond the existing ADR to provide comprehensive auth coverage for all applications.

## Explore
### Tasks
- [x] Review existing ADR 011 and understand current authentication analysis
- [x] Analyze current homelab authentication patterns and infrastructure
- [x] Identify different application types and their auth requirements
- [x] Research current authentication gaps and pain points
- [x] Document user preferences and constraints
- [x] Research Supabase OIDC provider compatibility requirements
- [x] Investigate nginx forward auth integration issues with Authelia
- [x] Explore alternative OIDC providers that work with both Supabase and nginx
- [x] Evaluate mixed authentication approach (OIDC + oauth2-proxy)
- [x] Research troubleshooting steps for Authelia + nginx integration
- [x] Assess integration complexity with existing infrastructure

### Completed
- [x] Created development plan file
- [x] Analyzed current authentication infrastructure and identified gaps
- [x] Gathered user requirements and constraints
- [x] Researched Supabase OIDC compatibility requirements
- [x] Investigated nginx forward auth integration issues from previous implementation
- [x] Analyzed existing Authelia implementation and identified resolved technical issues
- [x] Copied ADR 011 to current branch for reference
- [x] Critically assessed ADR complexity vs homelab needs
- [x] Simplified ADR to use SQLite backend and single-replica deployment
- [x] Rewrote ADR 011 to proper Nygard format (removed implementation details)
- [x] Completed comprehensive exploration of authentication landscape

## Plan
### Phase Entrance Criteria:
- [x] Current authentication state has been thoroughly analyzed
- [x] Authentication requirements for different app types have been identified
- [x] Authentication options and alternatives have been evaluated
- [x] Previous ADR findings have been reviewed and updated requirements identified
- [x] Technology choices have been researched with pros/cons documented
- [x] It's clear what's in scope and out of scope for this implementation

### Tasks
- [x] Design Authelia component architecture for homelab-specific deployment
- [x] Plan ExposedWebApp integration for forward auth annotation support
- [x] Define Authelia configuration strategy (storage, providers, OIDC clients)
- [x] Plan deployment sequence and dependency management
- [x] Design testing strategy for both forward auth and OIDC flows
- [x] Plan Supabase OIDC client configuration
- [x] Create migration strategy from oauth2-proxy to Authelia forward auth

### Completed
- [x] **Authelia Component Architecture**: Defined SQLite-based deployment with persistent storage, ConfigMap-based configuration, and Service/Ingress exposure
- [x] **ExposedWebApp Forward Auth Integration**: Designed `forwardAuth` option to inject nginx annotations, with progressive migration support
- [x] **Configuration Strategy**: Planned minimal homelab configuration with GitHub/Google providers, SQLite storage, and OIDC client setup
- [x] **Deployment Strategy**: Defined dependency chain and component integration approach
- [x] **Testing Plan**: Both forward auth (nginx) and OIDC (Supabase) validation flows
- [x] **Migration Approach**: Backward-compatible introduction with gradual oauth2-proxy replacement

## Code
### Phase Entrance Criteria:
- [x] Implementation strategy has been defined and approved
- [x] Architecture decisions have been documented 
- [x] Integration approach with existing infrastructure is clear
- [x] Security considerations have been addressed in the plan
- [x] Dependencies and deployment order have been identified
- [x] Testing strategy has been outlined

### Tasks
- [x] Add auth enum to ExposedWebApp: `auth: "none" | "forward"` (starting with these two only)
- [x] Implement forward auth nginx annotations injection
- [x] Test enum implementation with type checking and build
- [x] Create auth demo app in main index.ts to verify forward auth functionality
- [x] Create Authelia infrastructure module (`packages/core/infrastructure/src/authelia/index.ts`)  
- [x] Update core infrastructure index to export Authelia
- [x] Update base-infra stack to deploy Authelia infrastructure
- [x] Fix Authelia configuration for v4.38.0 (update deprecated keys)
- [x] Create script to generate Authelia secrets and store in Pulumi config
- [x] Update Authelia configuration to use Pulumi config for all secrets
- [x] Fix secrets script to handle multi-line RSA keys properly
- [x] Fix Authelia deployment configuration based on working claude/homelab-auth-stack-lNC7I branch
- [x] Add enableServiceLinks: false to prevent Kubernetes env var conflicts
- [x] Fix configuration format and environment variable substitution
- [ ] Create initial Authelia configuration with GitHub/Google OAuth
- [ ] Implement OIDC client configuration for Supabase compatibility
- [ ] Add forward auth testing with existing nginx setup
- [ ] Create Supabase OIDC integration test
- [ ] Update documentation and examples

### Completed
- [x] **Auth Enum Implementation**: Added `AuthType.NONE` and `AuthType.FORWARD` to ExposedWebApp
- [x] **Forward Auth Annotations**: Implemented nginx annotations for Authelia forward auth
- [x] **TypeScript Integration**: Updated exports and verified compilation works correctly
- [x] **API Design**: Clean enum interface - `auth: AuthType.FORWARD` enables Authelia protection
- [x] **Auth Demo App**: Created auth-demo.no-panic.org with forward auth for testing
- [x] **Authelia Infrastructure**: Implemented complete Authelia deployment (namespace, configmap, PVC, deployment, service, ingress)
- [x] **Base Infrastructure Integration**: Added Authelia exports to base-infra stack
- [x] **v4.38.0 Configuration**: Fixed all deprecated config keys, added required encryption_key and notifier
- [x] **Pulumi Config Integration**: Authelia uses homelab:domain and authelia: secrets from Pulumi config
- [x] **Secrets Generation Script**: Created setup-authelia-secrets.sh to generate and store secure secrets

## Commit
### Phase Entrance Criteria:
- [ ] Core authentication functionality has been implemented
- [ ] Integration with existing apps has been tested
- [ ] Security configurations are properly applied
- [ ] Documentation has been updated to reflect implementation
- [ ] Code quality standards have been met

### Tasks
- [ ] *To be added when this phase becomes active*

### Completed
*None yet*

## Implementation Strategy

### 1. Correct Architecture (Infrastructure Pattern)

**Authelia Infrastructure Module** (`packages/core/infrastructure/src/authelia/index.ts`) - Like cert-manager:
```typescript
// Infrastructure module - deploys singleton Authelia service
export const authelia = new k8s.apps.v1.Deployment("authelia", {
  // ... Authelia deployment
});

export const autheliaService = new k8s.core.v1.Service("authelia-service", {
  // ... Service exposing auth endpoints
});

export const autheliaIngress = new k8s.networking.v1.Ingress("authelia-ingress", {
  // ... Public ingress for auth flows
});
```

**Deployment Pattern** (follows cert-manager pattern):
- **Namespace**: `authelia` with restricted pod security  
- **ConfigMap**: YAML configuration with homelab-specific settings
- **Persistent Storage**: SQLite database + session storage on longhorn-persistent
- **Secret**: External secrets for OAuth client credentials
- **Service**: ClusterIP for forward auth + OIDC endpoints
- **Ingress**: Public access for auth flows and OIDC discovery
- **Export**: Service references for ExposedWebApp forward auth

### 2. Clean ExposedWebApp API

**Auth Enum Design**:
```typescript
enum AuthType {
  NONE = "none",      // No authentication 
  FORWARD = "forward", // Authelia forward auth (new)
  SIDECAR = "sidecar"  // OAuth2-proxy sidecar (existing)
}

interface ExposedWebAppArgs {
  // ... existing fields
  auth?: AuthType;     // Defaults to "none"
  oauth?: OAuthConfig; // Only used when auth: "sidecar"
}
```

**Implementation Logic**:
```typescript
// In ExposedWebApp component
if (args.auth === "forward") {
  // Add nginx forward auth annotations
  ingressAnnotations["nginx.ingress.kubernetes.io/auth-url"] = 
    "http://authelia.authelia.svc.cluster.local:9091/api/verify";
  ingressAnnotations["nginx.ingress.kubernetes.io/auth-signin"] = 
    "https://auth.no-panic.org/?rm=$request_method&rd=$request_uri";
}
else if (args.auth === "sidecar" && args.oauth) {
  // Existing oauth2-proxy sidecar logic
}
// else: no auth (current default behavior)
```

**Migration Strategy**:
- **Phase 1**: Add enum, `auth: "sidecar"` maintains existing behavior  
- **Phase 2**: `auth: "forward"` enables Authelia for new apps
- **Phase 3**: Migrate apps from `"sidecar"` to `"forward"`
- **Phase 4**: Remove oauth2-proxy sidecar code when unused

### 3. Configuration Strategy

**Minimal SQLite Configuration**:
```yaml
storage:
  local:
    path: /data/db.sqlite3
  
authentication_backend:
  file:
    path: /data/users_database.yml  # Simple file-based users for homelab

access_control:
  default_policy: deny
  rules:
    - domain: "*.no-panic.org"
      policy: one_factor      # GitHub/Google OAuth sufficient for homelab

identity_providers:
  oidc:
    clients:
      - id: supabase
        description: "Supabase Auth"
        secret: "$pbkdf2-sha512$..."  # Generated secret hash
        redirect_uris:
          - "https://your-supabase.supabase.co/auth/v1/callback"
        scopes: ["openid", "profile", "email"]
        grant_types: ["authorization_code"]
        
session:
  name: authelia_session
  domain: no-panic.org
  same_site: lax

regulation:
  max_retries: 3
  find_time: 2m
  ban_time: 5m

notifier:
  disable_startup_check: true  # No email notifications for homelab
  
webauthn:
  disable: true               # FIDO2/WebAuthn not needed initially
```

### 4. Deployment Sequence

**Component Dependencies**:
1. **longhorn-persistent** storage class (already exists)
2. **External Secrets Operator** for OAuth credentials (already exists)  
3. **nginx-ingress-controller** for forward auth (already exists)
4. **Authelia component** deployment
5. **ExposedWebApp updates** for forward auth support

**Integration Order**:
1. Deploy Authelia service with basic configuration
2. Test forward auth with simple nginx test app
3. Configure OIDC client for Supabase integration
4. Update ExposedWebApp component with forward auth option
5. Migrate first application (storage-validator) to forward auth
6. Validate end-to-end authentication flows

### 5. Testing Strategy

**Forward Auth Validation**:
- Deploy test app with `forwardAuth: { enabled: true }`
- Verify redirect to Authelia login page
- Test GitHub/Google OAuth flow completion
- Confirm app access after successful authentication
- Validate logout and session handling

**OIDC Provider Validation**:
- Configure Supabase with Authelia OIDC endpoints
- Test OIDC discovery endpoint (`/.well-known/openid-configuration`)
- Verify authorization code flow with PKCE
- Test token exchange and user info endpoints
- Validate JWT token format and claims

**Security Testing**:
- Test unauthenticated access blocking
- Verify session security (httpOnly, secure cookies)
- Test CSRF protection
- Validate redirect URI restrictions for OIDC clients

### 6. Supabase OIDC Configuration

**Authelia OIDC Client Setup**:
```yaml
identity_providers:
  oidc:
    issuer_private_key: |  # Generated RSA key for JWT signing
      -----BEGIN RSA PRIVATE KEY-----
      ...
      -----END RSA PRIVATE KEY-----
    clients:
      - id: supabase-auth
        description: "Supabase External Auth"
        secret: "$pbkdf2-sha512$..."
        redirect_uris:
          - "https://your-project.supabase.co/auth/v1/callback"
        scopes: ["openid", "profile", "email"]
        grant_types: ["authorization_code"]
        response_types: ["code"]
        token_endpoint_auth_method: "client_secret_post"
```

**Supabase Configuration**:
- **Provider**: Custom OIDC
- **Issuer URL**: `https://auth.no-panic.org`
- **Client ID**: `supabase-auth`
- **Client Secret**: Generated and stored in Supabase dashboard
- **Scopes**: `openid profile email`

## Key Decisions

### Exploration Phase Decisions:
1. **Authelia is the optimal choice** - Already implemented and working, OpenID Connect certified, perfect for dual-purpose use
2. **Previous nginx integration issues were resolved** - Technical problems that prevented forward auth are already fixed
3. **No need for alternative OIDC providers** - Authelia meets all requirements (Supabase compatibility + forward auth)
4. **Current implementation can be leveraged** - Working Authelia deployment exists with resolved configuration issues

### Planning Phase Decisions:
1. **SQLite Backend Approach** - Simple, file-based storage appropriate for homelab scale with automatic R2 backups via longhorn-persistent
2. **Progressive Migration Strategy** - Maintain oauth2-proxy compatibility during transition to reduce risk
3. **Minimal Configuration** - Start simple with GitHub/Google OAuth, expand as needed
4. **Infrastructure Pattern** - Authelia as infrastructure module (like cert-manager), not component
5. **Clean Enum API** - `auth: "none" | "forward" | "sidecar"` for ExposedWebApp authentication choice
6. **Singleton Service** - One Authelia instance serves entire homelab, not per-app deployment

## Notes
- User mentioned previous Claude discussion that "jumped to conclusions too fast"
- Existing ADR 011 in branch claude/homelab-auth-stack-lNC7I provides foundation but needs review
- Current stack uses oauth2-proxy sidecar pattern, need to evaluate if this should be evolved or replaced

### Current Authentication Analysis Summary
**Current State**: Minimal oauth2-proxy sidecar pattern with per-app configuration
**Infrastructure**: Well-prepared with ESO, ingress-nginx, cert-manager, Cloudflare integration
**Key Gap**: No centralized authentication service (SSO, forward auth, RBAC)
**Pain Points**: Per-app OAuth setup, limited access control options, no application-level auth support
**Ready Infrastructure**: ingress-nginx hints at previous Authelia consideration (authelia.authelia.svc.cluster.local)

### User Requirements (Gathered)
**Primary Goal**: Supabase-compatible auth provider for custom applications
**Access Patterns**: 
- Home apps with restricted access (forward auth protection)
- Self-managed apps with their own user systems (via Supabase)
**Previous Experience**: Authelia implementation exists but forward auth integration with nginx failed
**Compatibility Requirement**: Must work with Supabase as OIDC provider
**Documentation Available**: Official Authelia + nginx docs exist but integration didn't work

### Research Findings

**Supabase OIDC Compatibility**:
- Requires standard OIDC endpoints (Authorization, Token, UserInfo, JWKS)
- Needs openid, email, profile scopes
- Authorization Code flow with PKCE support
- Authelia is OpenID Connect certified and fully compatible

**Previous Implementation Analysis**:
- ✅ Authelia v4.38 is already deployed and operational in claude/homelab-auth-stack-lNC7I branch
- ✅ nginx forward auth integration issues were resolved (X-Forwarded-Proto, endpoint config, DNS resolution)
- ✅ Working forward auth confirmed with secure-demo app
- ⏳ GitHub/Google OAuth setup pending (external configuration needed)
- ⏳ Supabase OIDC integration not yet implemented

**Key Technical Issues That Were Resolved**:
1. HTTPS header forwarding through Cloudflare tunnel (fixed)
2. nginx configuration snippets disabled (fixed)  
3. Authelia endpoint misconfiguration (fixed)
4. Service discovery for auth URLs (fixed)
5. ConfigMap corruption issues (fixed)

### ADR 011 Critical Analysis

**✅ What's Good About the ADR:**
- Clear context and requirements definition
- Comprehensive alternative evaluation
- Technical architecture is sound
- Implementation strategy is detailed
- Status tracking shows actual progress

**⚠️ Concerns About the ADR:**
- Claims "Implemented ✅" but user says nginx integration didn't work
- Very complex for a homelab (PostgreSQL backend, 2 replicas, etc.)
- May be over-engineered - solving problems that don't exist yet
- Assumes complex access policies needed from day 1
- Implementation notes suggest many issues were encountered

**❓ Questions for User:**
- Is the complexity level appropriate for your homelab?
- Do you actually need PostgreSQL backend vs simpler file-based config?
- Do you need 2-replica HA for a homelab?
- Is the forward-auth pattern the right choice vs simpler oauth2-proxy evolution?

### User Feedback on ADR Complexity
**SQLite Backend Option**: User noted Authelia supports SQLite, which would be much simpler than PostgreSQL for homelab use

---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
