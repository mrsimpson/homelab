# Development Plan: homelab (externalize-exposed-webapp branch)

*Generated on 2026-04-12 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal
Enable apps from external repositories (with their own CI/CD) to be deployed on the homelab k8s cluster without living in this monorepo. Specifically: extract `opencode-router` and `opencode-cloudflare-operator` so they can be published and consumed as Helm charts, while the homelab Pulumi stack remains the single source of truth for cluster state.

## Explore
<!-- beads-phase-id: homelab-5.1 -->
### Tasks

*Tasks managed via `bd` CLI*

## Plan
<!-- beads-phase-id: homelab-5.2 -->
### Phase Entrance Criteria:
- [ ] Current architecture and dependencies of opencode-router/operator are fully understood
- [ ] Integration points between opencode apps and homelab core packages are identified
- [ ] The chosen externalization approach (Helm charts vs published npm packages vs other) is decided
- [ ] It's clear what stays in homelab vs what moves to the external repo

### Tasks

*Tasks managed via `bd` CLI*

## Code
<!-- beads-phase-id: homelab-5.3 -->
### Phase Entrance Criteria:
- [ ] The integration contract (Helm chart values schema, image references) is defined
- [ ] A concrete implementation plan with actionable steps exists
- [ ] The approach has been validated against the existing codebase

### Tasks

*Tasks managed via `bd` CLI*

## Commit
<!-- beads-phase-id: homelab-5.4 -->
### Phase Entrance Criteria:
- [ ] Homelab can consume the opencode apps via the new integration contract (Helm chart or equivalent)
- [ ] The removed Pulumi app packages are no longer needed for `pulumi up` to succeed
- [ ] Changes are tested (at minimum: type-check passes, Pulumi preview succeeds)

### Tasks

*Tasks managed via `bd` CLI*

## Key Decisions

### D1: Zero-touch homelab requirement
Adding a new external app must NOT require changes to the homelab repo. This rules out any approach where deployment recipes live in homelab.

### D2: Approach — Published npm packages + Pulumi ESC (decided)
### D3: Implementation order — Refactor first, verify, then publish
### D4: Provide factory function + Makefile template for external repos
- `createHomelabContextFromStack(stackName)` factory in core-components — reconstructs HomelabContext from StackReference outputs, zero boilerplate for consumers
- Makefile template with `init`, `preview`, `deploy` targets for minimal local CD
1. Refactor core-components to be externally consumable (decouple from homelabConfig)
2. Verify everything still deploys as-is (type-check + pulumi preview)
3. Then publish and set up external consumption (publishConfig, GH Actions, ESC)
**Publish `@mrsimpson/homelab-core-components` to GitHub npm registry. External repos use own Pulumi stacks with StackReference for infra facts and Pulumi ESC for shared secrets.**
See [ADR 013](../docs/adr/013-external-app-deployment-with-published-packages-and-esc.md) for full analysis including Pugh decision matrix.

## Notes

### Explore Findings

**What opencode-router depends on from homelab core:**
1. `HomelabContext` — specifically `homelab.createExposedWebApp()` which bundles: Deployment, Service, OAuth2-Proxy middleware, IngressRoutes, Cloudflare DNS CNAME, GHCR pull secret
2. `AuthType.OAUTH2_PROXY` — enum value for auth configuration
3. `CloudflareConfig` — type for cloudflare tunnel/zone config
4. `homelabConfig.domain` — the base domain string (e.g. "no-panic.org")

**What opencode-cloudflare-operator depends on from homelab core:**
- Nothing! It only uses `@pulumi/kubernetes` and `@pulumi/pulumi`. It's already self-contained as Pulumi code.

**What `createExposedWebApp` does (the hard part to replicate):**
- Creates a k8s Deployment + Service
- Sets up OAuth2-Proxy middleware chain (Traefik IngressRoute middlewares)
- Creates Cloudflare DNS CNAME pointing to the tunnel
- Creates GHCR pull secret via ExternalSecret
- Wires up TLS, probes, env vars, storage, extra containers

**The core challenge:** `createExposedWebApp` is a ~500-line Pulumi component that encapsulates a LOT of homelab-specific wiring (Traefik IngressRoutes, Cloudflare tunnel DNS, OAuth2-Proxy middleware chains, ExternalSecrets for GHCR). Any externalization approach must either:
- (a) Replicate this logic in the external repo (Helm chart), or
- (b) Publish the Pulumi component so external repos can use it, or  
- (c) Keep the Pulumi orchestration in homelab but consume external artifacts (images/charts)

**Current approach (option c, status quo):** The homelab already consumes external *images* (`routerImage`, `cfOperatorImage`, `opencodeImage` are all config values pointing to ghcr.io). The Pulumi app packages in `packages/apps/opencode-*` are really just "deployment recipes" that use homelab core to wire things up.

**Key insight:** The opencode-router package doesn't contain the app code — it's purely deployment glue. The actual app code (router, operator) is already built externally and published as Docker images. The question is whether the *deployment recipe* should also live externally.

### Deep dive: What `ExposedWebApp` provides (918 lines)
The component handles:
1. **Namespace** creation with Pod Security Standards (restricted/baseline/privileged auto-detection)
2. **Deployment** + **Service** with security contexts, probes, sidecars, init containers
3. **Auth routing** (3 modes):
   - NONE → Gateway API HTTPRoute
   - FORWARD → Authelia ForwardAuth middleware + HTTPRoute
   - OAUTH2_PROXY → 3 Traefik middlewares (ForwardAuth, Errors, Chain) + 2 IngressRoutes (sign-in + app)
4. **Cloudflare DNS** CNAME record (proxied, pointing to tunnel)
5. **ExternalSecrets** for GHCR/DockerHub pull credentials
6. **PVC** creation with configurable storage class
7. **Extra containers/volumes/init containers** support

### `HomelabContext` (49 lines)
Thin wrapper that auto-injects infrastructure deps (cloudflare, TLS, gatewayApi, externalSecrets) so apps don't need to pass them.

### `homelabConfig` (63 lines)
Reads Pulumi config values. An external repo would need its own Pulumi config or read these via StackReference.

### What an external repo needs from homelab stack (via StackReference):
- `cloudflare.zoneId`, `cloudflare.tunnelCname`, `cloudflare.tunnelId`
- The fact that Traefik, ExternalSecrets operator, oauth2-proxy, and cert-manager exist in the cluster
- Domain name (could be hardcoded or read from stack)

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*

### D5: Publish to npmjs.com instead of GitHub Packages (decided 2026-04-12)
**Decision:** Moved `@mrsimpson/homelab-core-components` from GitHub npm registry to the public npmjs.com registry.

**Rationale:**
- The package contains no sensitive information (no secrets, no tokens, no private IPs — only generic Pulumi component abstractions and conventional homelab names)
- The package is MIT licensed and `"access": "public"` — there is no reason to restrict it
- GitHub Packages requires authentication even for public packages, meaning every consumer (CI or developer) needs a `NODE_AUTH_TOKEN` and a scoped `.npmrc` override
- npmjs.com allows completely frictionless consumption: `npm install @mrsimpson/homelab-core-components` with no auth, no `.npmrc`, no extra CI secrets
- The user's other packages are already on npmjs.com — consistency

**Changes made:**
- `packages/core/components/package.json` — `publishConfig.registry` → `https://registry.npmjs.org`
- `packages/core/components/.npmrc` — deleted (GitHub scoped override no longer needed)
- `.npmrc` (root) — deleted (GitHub scoped override no longer needed)
- `.github/workflows/publish-core-components.yml` — `registry-url` → `https://registry.npmjs.org`, `NODE_AUTH_TOKEN` → `${{ secrets.NPM_TOKEN }}`
- `opencode/homelab/.npmrc` — cleared (auth token and scope override removed)
- `opencode/.github/workflows/deploy-homelab.yml` — removed `registry-url`, `scope`, `NODE_AUTH_TOKEN` from `setup-node` step
- Docs updated: ADR-013 (status → Accepted, all GitHub Packages references → npmjs.com), `external-app-setup.md`

**Published:** `@mrsimpson/homelab-core-components@0.1.0` — https://www.npmjs.com/package/@mrsimpson/homelab-core-components
