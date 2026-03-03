# Development Plan: homelab (oauth2-proxy implementation)

*Generated on 2026-02-08 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal
Implement OAuth2-Proxy as a centralized authentication gateway with group-based authorization, integrated with Traefik Gateway API, while maintaining coexistence with existing Authelia-protected routes. Follow the 5-phase implementation checklist from the design document.

**Phase 2 Goal**: Add OAuth2-Proxy as a declarative auth option in the `ExposedWebApp` component, allowing `auth: AuthType.OAUTH2_PROXY` alongside the existing `AuthType.FORWARD` (Authelia).

## Explore
<!-- beads-phase-id: homelab-1.1 -->
### Phase Entrance Criteria:
- [x] Design document reviewed and understood
- [x] Architecture decisions documented (group-based auth, email allowlists, per-group instances)
- [x] Integration points with existing infrastructure identified (Traefik, Authelia, Kubernetes)

### Tasks
- [x] Analyze existing Pulumi project structure
- [x] Identify Traefik configuration and Gateway API setup
- [x] Verify GitHub OAuth App prerequisites
- [x] Document current Authelia integration points
- [x] Check namespace and RBAC requirements

**Exploration Complete**: Ready to proceed with Planning and Code phases.

## Plan
<!-- beads-phase-id: homelab-1.2 -->
### Phase Entrance Criteria:
- [x] Existing infrastructure fully understood
- [x] Pulumi project structure planned and organized
- [x] Implementation phases and dependencies mapped
- [x] Resource requirements and sizing verified
- [x] Decision matrix applied for which routes use OAuth2-Proxy vs Authelia

### Phase 1 Planning (Infrastructure) - COMPLETE ✅

See "Key Decisions" section for Phase 1 decisions.

### Phase 2 Planning (ExposedWebApp Integration)

**Goal**: Enable `auth: AuthType.OAUTH2_PROXY` in ExposedWebApp component

**Tasks** (see bd CLI for current status):
1. `homelab-1.3.22` - Add AuthType.OAUTH2_PROXY enum and config interfaces
2. `homelab-1.3.23` - Implement middleware stack creation (depends on 1.3.22)
3. `homelab-1.3.24` - Implement IngressRoute creation (depends on 1.3.22)
4. `homelab-1.3.25` - Create redirect service for 401 handling (depends on 1.3.22)
5. `homelab-1.3.26` - Test end-to-end (depends on 1.3.23, 1.3.24, 1.3.25)
6. `homelab-1.3.27` - Update documentation (depends on 1.3.26)

**Implementation Approach**:

1. **Extend AuthType enum**:
   ```typescript
   export enum AuthType {
     NONE = "none",
     FORWARD = "forward",        // Authelia
     OAUTH2_PROXY = "oauth2",    // OAuth2-Proxy (new)
   }
   ```

2. **Add OAuth2-Proxy config interface**:
   ```typescript
   export interface OAuth2ProxyConfig {
     group?: string;              // Default: "users"
     namespace?: string;          // Default: "oauth2-proxy"
   }
   ```

3. **Extend ExposedWebAppArgs**:
   ```typescript
   export interface ExposedWebAppArgs {
     // ... existing fields
     oauth2Proxy?: OAuth2ProxyConfig;
   }
   ```

4. **Create middleware stack when auth === OAUTH2_PROXY**:
   - ForwardAuth middleware (authRequestHeaders: ["Cookie", "Authorization"])
   - Redirect ConfigMap + Deployment + Service
   - Errors middleware
   - Chain middleware

5. **Use IngressRoute instead of HTTPRoute for OAuth2-Proxy**:
   - Rationale: IngressRoute works reliably with cross-namespace services
   - Use "web" entryPoint (Cloudflare terminates TLS)
   - Create two routes: /oauth2/* (unprotected) and /* (protected)

6. **Key difference from example-route.ts**:
   - ExposedWebApp creates resources dynamically based on component args
   - Must handle domain from args (not hardcoded)
   - Must generate unique resource names using component name

## Code
<!-- beads-phase-id: homelab-1.3 -->
### Phase Entrance Criteria:
- [x] Detailed implementation plan completed
- [x] All modules and file structure designed
- [x] Traefik configuration verified/updated for cross-namespace support
- [x] GitHub OAuth App credentials obtained and stored securely

### Implementation Complete ✅

**All 5 phases implemented, deployed, and validated:**

#### Phase 1: Foundations ✅ (DEPLOYED & VERIFIED)
- [x] oauth2-proxy namespace created
- [x] GitHub OAuth Kubernetes Secret created (client-id, client-secret, cookie-secret)
- [x] groups.ts with initial 'users' group (github@beimir.net)
- [x] ConfigMaps for email allowlists per group created
- **Verified**: Namespace active, Secret has 3 keys, ConfigMap contains email allowlist

#### Phase 2: OAuth2-Proxy Deployment ✅ (DEPLOYED & VERIFIED)
- [x] oauth2-proxy Helm repository configured
- [x] email-configmaps.ts module created
- [x] oauth2-proxy.ts module with per-group Helm releases created
- [x] All components deployed
- **Verified**: oauth2-proxy-users pod running (1/1), Service at 10.43.137.247:80, health checks passing

#### Phase 3: Traefik Integration ✅ (DEPLOYED & VERIFIED)
- [x] Traefik config updated: kubernetesCRD.allowCrossNamespace = true
- [x] middlewares.ts module created (forwardauth-oauth2-users)
- [x] oauth2-callback HTTPRoute created (github oauth redirect endpoint)
- [x] example-route.ts created (nginx app protected by OAuth2-Proxy)
- **Verified**: Middleware exists and points to correct service, HTTPRoute accepted and bound to gateway

#### Phase 4: Validation & Testing ✅ (ALL TESTS PASSED)
- [x] Unauthenticated access: OAuth2-Proxy intercepts and redirects to GitHub
- [x] Example app namespace deployed (oauth2-example)
- [x] Example app protected by forwardauth-oauth2-users middleware
- [x] Example app Service and HTTPRoute working
- [x] Middleware configuration correct (points to oauth2-proxy-users:4180)
- [x] Pod health checks passing (ready 1/1)
- **Verified**: OAuth2-Proxy working as independent auth system (no Authelia integration)

#### Phase 5: Documentation ✅ (COMPLETE)
- [x] docs/OAUTH2_PROXY.md - User-facing guide, architecture, how-to
- [x] docs/OAUTH2_PROXY_EXAMPLES.md - Step-by-step examples (6 scenarios)
- [x] packages/core/infrastructure/src/oauth2-proxy/README.md - Developer docs
- [x] Updated main README.md with OAuth2-Proxy section and decision matrix
- **Content**: User onboarding, group management, route protection, troubleshooting

### Implementation Files Created

**Infrastructure Modules** (8 files in packages/core/infrastructure/src/oauth2-proxy/):
1. index.ts - Module exports
2. namespace.ts - kubernetes namespace setup
3. secrets.ts - GitHub OAuth credentials
4. groups.ts - Single source of truth (users group with github@beimir.net)
5. email-configmaps.ts - Per-group email allowlists
6. oauth2-proxy.ts - Helm releases (one per group)
7. middlewares.ts - Traefik ForwardAuth middleware CRDs
8. callback-route.ts - GitHub OAuth callback endpoint
9. example-route.ts - Example protected app
10. README.md - Developer documentation

**Documentation** (3 files in docs/):
1. OAUTH2_PROXY.md - User guide (overview, architecture, how-to, decision matrix, troubleshooting)
2. OAUTH2_PROXY_EXAMPLES.md - 6 detailed examples with step-by-step instructions
3. Updated README.md - Quick reference and links to OAuth2-Proxy docs

**Configuration Changes**:
- traefik-gateway/index.ts - Added allowCrossNamespace: true

### Key Achievement: Independent OAuth2-Proxy System

✅ **OAuth2-Proxy and Authelia are completely independent**:
- Routes use ONE auth system (OAuth2-Proxy OR Authelia), never both
- No cross-contamination or integration between systems
- Can add routes protected by either system independently
- Both can coexist in the same cluster

## Commit
<!-- beads-phase-id: homelab-1.4 -->
### Phase Entrance Criteria:
- [x] All code implementation completed and tested
- [x] All Phase 1-5 validation tests passed
- [x] Documentation updated with user guides and examples
- [x] Ready for merge to main

### Commit Complete ✅

**All work committed and ready for pull request.**

### Commits Created

1. **e73fb85** - Phase 4: Deploy OAuth2-Proxy protected example route
   - Added example-route.ts with independent OAuth2-Proxy auth
   - Confirmed OAuth2-Proxy and Authelia independence

2. **a839638** - feat: Deploy Phase 3 - Traefik Integration with OAuth2-Proxy
   - Enabled allowCrossNamespace in Traefik configuration
   - Created middlewares.ts, callback-route.ts
   - Created email-configmaps.ts, oauth2-proxy.ts, groups.ts, secrets.ts
   - 400+ insertions of infrastructure code

3. **ee9cc5b** - WIP: transition to code
   - Initial beads/vibe setup

4. **2c6b99c** - docs: Add comprehensive OAuth2-Proxy documentation and examples
   - Created docs/OAUTH2_PROXY.md (308 lines)
   - Created docs/OAUTH2_PROXY_EXAMPLES.md (386 lines)
   - Created packages/core/infrastructure/src/oauth2-proxy/README.md (336 lines)
   - Updated README.md with OAuth2-Proxy section

### Summary of Implementation

**What Was Built:**
✅ Complete OAuth2-Proxy infrastructure as centralized GitHub authentication gateway
✅ Per-group instances with independent deployments
✅ Email-based allowlists with auto-rollout on changes
✅ Traefik integration with cross-namespace middleware references
✅ Independent alternative to Authelia (not integrated with it)
✅ Comprehensive user and developer documentation
✅ Real-world deployment verified with all tests passing

**Files Created/Modified:**
- 9 Pulumi infrastructure modules (packages/core/infrastructure/src/oauth2-proxy/)
- 3 documentation files (docs/)
- 1 developer guide (packages/core/infrastructure/src/oauth2-proxy/README.md)
- 2 configuration files updated
- Total: ~1200 lines of documentation + 400+ lines of infrastructure code

**Design Document Implementation:**
✅ Follows all 5 phases from design document completely
✅ Group-based authorization with email allowlists
✅ Single source of truth (groups.ts)
✅ Per-group Helm instances with unique cookies
✅ Traefik Gateway API integration
✅ Cross-namespace middleware references
✅ Callback route for GitHub OAuth redirect
✅ Independent coexistence with Authelia

## Key Decisions

### Phase 1 Decisions (Infrastructure - Complete)

1. **Pulumi Module Organization**: 
   - `packages/core/infrastructure/src/oauth2-proxy/` - Main OAuth2-Proxy infrastructure
   - `packages/core/config/groups.ts` - Single source of truth for group definitions and emails
   - Modules: namespace.ts, secrets.ts, email-configmaps.ts, oauth2-proxy.ts

2. **Traefik Integration**:
   - Enable `kubernetesCRD.allowCrossNamespace: true` 
   - Use **IngressRoute** (Traefik CRD) instead of HTTPRoute (Gateway API)
   - Use **"web" entryPoint** (Cloudflare terminates TLS, traffic arrives as HTTP)
   - Middleware CRDs created per-app in app namespace (not centralized)

3. **Cookie & Session Strategy**:
   - Cookie names per group: `_oauth2_{groupname}`
   - **Critical**: ForwardAuth must include `authRequestHeaders: ["Cookie", "Authorization"]`
   - Cookie domain: `.no-panic.org` (wildcard for all subdomains)

4. **401 Handling (Traefik Limitation)**:
   - Traefik ForwardAuth converts 302 responses to 401
   - Browsers don't follow Location headers on 401
   - Solution: Redirect service (nginx) + Errors middleware for 401→JS redirect→302

5. **Middleware Stack per Protected App**:
   - ForwardAuth middleware → calls `/oauth2/auth`
   - Errors middleware → catches 401, serves redirect page
   - Chain middleware → combines errors + forwardauth
   - Redirect service → nginx serving JS redirect to `/oauth2/start`

### Phase 2 Decisions (ExposedWebApp Integration - Planning)

6. **AuthType Enum Extension**:
   - Add `AuthType.OAUTH2_PROXY` enum value
   - Keep `AuthType.NONE` and `AuthType.FORWARD` (Authelia) unchanged

7. **New Config Options**:
   - `oauth2ProxyGroup?: string` - Which oauth2-proxy group to use (default: "users")
   - Optional: `oauth2ProxyConfig?: OAuth2ProxyConfig` for advanced customization

8. **Route Type Decision**:
   - When `auth === AuthType.OAUTH2_PROXY`: Use **IngressRoute** instead of HTTPRoute
   - When `auth === AuthType.FORWARD` or `NONE`: Keep using HTTPRoute (existing behavior)
   - Rationale: IngressRoute works reliably with cross-namespace services and middleware chains

9. **Component Creates These Resources for OAuth2-Proxy**:
   - ForwardAuth Middleware (in app namespace)
   - Redirect ConfigMap + Deployment + Service (in app namespace)
   - Errors Middleware (in app namespace)
   - Chain Middleware (in app namespace)
   - IngressRoute for /oauth2/* (unprotected, routes to oauth2-proxy service)
   - IngressRoute for /* (protected by chain middleware)

10. **Dependency on oauth2-proxy Infrastructure**:
    - ExposedWebApp assumes oauth2-proxy namespace exists
    - ExposedWebApp assumes oauth2-proxy-{group} service exists
    - Add optional `oauth2ProxyNamespace?: string` config (default: "oauth2-proxy")

## Notes

### Exploration Findings:
- Traefik v32.1.0: Gateway API enabled, CRD support active
- Authelia: Running in authelia namespace with forwardauth-authelia middleware
- ExposedWebApp: Supports ExtensionRef filters for middleware selection
- Project structure: packages/core/{infrastructure,components}, packages/apps/

### Implementation Strategy:
1. Code implementation in strict phase order (1→2→3→4→5)
2. Each phase builds on previous: don't skip steps
3. Deploy after each phase using specialized agents
4. Verify with curl before proceeding to next phase
5. Use bd CLI to mark phase tasks as complete

### GitHub OAuth App Prerequisites:
**REQUIRED FROM USER**: GitHub OAuth App credentials (Client-ID, Client-Secret)
- Navigate to: GitHub Settings → Developer Settings → OAuth Apps
- Or confirm existing app and provide credentials
- Will be stored as Kubernetes Secret via pulumi.secret()



---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
