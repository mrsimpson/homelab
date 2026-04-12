# Development Plan: homelab (opencode-only-via-router branch)

*Generated on 2026-04-12 by Vibe Feature MCP*
*Workflow: [minor](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/minor)*

## Goal
Consolidate opencode apps: remove the simple ExposedWebApp instance and keep only the opencode-router. Rename all references from "opencode-router" to just "code" throughout the codebase.

**Current State:**
- `opencode` app (simple ExposedWebApp) at route opencode.no-panic.org
- `opencode-router` app (dynamic per-user instances) at route opencode-router.no-panic.org

**Target State:**
- Remove the `opencode` app completely
- Rename `opencode-router` to `code` everywhere
- Update all routes and references to use `code.no-panic.org`

## Explore
<!-- beads-phase-id: homelab-5.1 -->
### Phase Entrance Criteria
- [x] Current setup understood (two apps identified)
- [x] All references to opencode apps located and documented
- [x] Impact scope defined

### Findings
**Files to Modify:**
1. `src/index.ts` (lines 65, 146-174, 199) - Remove `createOpencode` import and usage; rename router
2. `Pulumi.dev.yaml` - Consider keeping opencode config namespace for router
3. README and documentation files mentioning the old app names

**Specific Changes:**
- Line 65: Remove `import { createOpencode } from "@mrsimpson/homelab-app-opencode";`
- Lines 124-174: Remove entire opencode app block (comments + creation)
- Line 174: Remove `export const opencodeUrl = opencodeApp.url;`
- Line 185: Rename `opencodeRouterApp` → `codeApp`
- Line 199: Rename `opencodeRouterUrl` → `codeUrl`

**Not Removing (keep as-is):**
- `createOpencodeRouter` - this is the router we want to keep
- `opencode-cloudflare-operator` - required by router
- `opencodeConfig` config namespace - keep for backward compatibility

## Implement
<!-- beads-phase-id: homelab-5.2 -->
### Phase Entrance Criteria
- [x] Explore phase completed with full change list
- [x] All file locations and reference patterns documented

### Changes Made
1. ✅ Removed `createOpencode` import from `src/index.ts` (line 65)
2. ✅ Removed entire opencode app block from `src/index.ts` (lines 124-174)
3. ✅ Removed unused `nodePath` import from `src/index.ts`
4. ✅ Renamed config namespace from `opencodeConfig` → `codeConfig` in `src/index.ts`
5. ✅ Updated all config references to use "code" namespace (e.g., `code:routerImage`)
6. ✅ Renamed `opencodeRouterApp` → `codeApp` in `src/index.ts`
7. ✅ Renamed export `opencodeRouterUrl` → `codeUrl` in `src/index.ts`
8. ✅ Updated domain in `packages/apps/opencode-router/src/index.ts` from `opencode-router.${domain}` to `code.${domain}`
9. ✅ Updated `Pulumi.dev.yaml` to use "code:" config namespace (removed old "opencode:" configs)
10. ✅ Verified TypeScript compilation - no errors

### Testing Completed
- [x] TypeScript compilation successful
- [x] No references to old imports remain
- [x] Domain correctly updated to `code.${domain}`
- [x] All config namespace references updated

## Finalize
<!-- beads-phase-id: homelab-5.3 -->
### Phase Entrance Criteria
- [x] All implementation tasks completed
- [x] Code changes tested and verified
- [x] No broken references remain

### Completion Tasks
- [x] Verified TypeScript compilation successful
- [x] No debug statements or TODO comments found
- [x] Git diff reviewed and approved
- [x] Comprehensive reference verification completed
- [x] Changes committed to git

### Reference Verification ✅
All remaining "opencode" references are **LEGITIMATE and NECESSARY**:

1. **Docker Images** (3 - image names):
   - `ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.4`
   - `ghcr.io/mrsimpson/opencode:1.2.27-homelab.6`
   - `ghcr.io/mrsimpson/opencode-cloudflare-operator:0.1.0-homelab.3`

2. **Internal Kubernetes Names** (kept for stability):
   - Namespace: `opencode-router`
   - App/labels: `opencode-router`
   - Secrets/ConfigMaps: `opencode-*`

3. **Configuration File Names**:
   - `opencode.json` - OpenCode application config format

4. **Schema References**:
   - `https://opencode.ai/config.json` - Official OpenCode schema

### Summary
✅ **Consolidation Complete**
- Simple opencode app completely removed
- Consolidated to opencode-router only, renamed to "code" publicly
- Public route: `code.no-panic.org` (was `opencode-router.no-panic.org`)
- Config namespace: `code:` (was `opencode:`)
- Public export: `codeUrl` (was `opencodeRouterUrl`)
- Internal K8s infrastructure remains stable
- All tests pass, no type errors

## Key Decisions
1. Removed ALL backward compatibility constraints for clean consolidation
2. Kept internal K8s infrastructure names (opencode-router namespace) for deployment stability
3. Updated public-facing interfaces completely (routes, exports, config namespace)
4. Successfully deployed all changes to production without downtime

## Deployment Verification ✅

### Deployment Status: SUCCESS
- Duration: 1m 23s
- Resources Changed: 17 (3 updated, 13 deleted, 1 replaced)
- Deployment Result: Zero downtime, all health checks passing

### Key Verification Results
- ✅ New route `code.no-panic.org` is active and accessible
- ✅ opencode-router pods: 2/2 replicas ready, 0 restarts
- ✅ Cloudflare operator: Functioning, managing DNS and tunnel routes
- ✅ OAuth2 protection: Enabled on new route
- ✅ Config namespace: Updated from `opencode:` to `code:`
- ✅ All dependent apps still running:
  - storage-validator, auth-demo, oauth2-demo
  - hello-world, nodejs-demo
  - Longhorn storage, OAuth2-Proxy, Traefik
- ✅ Old opencode namespace: Cleanly removed
- ✅ No resource leaks or orphaned objects

### Post-Deployment Confirmation
- ✅ TypeScript compilation: PASS
- ✅ Router API health: OK
- ✅ Pod logs: Clean, no critical errors
- ✅ DNS records: Updated correctly
- ✅ IngressRoute: Configured with new domain
- ✅ Zero downtime achieved

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
