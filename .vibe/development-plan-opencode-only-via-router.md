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
- [x] Changes ready for commit

### Summary
Successfully removed the simple opencode app (ExposedWebApp) and consolidated to the opencode-router only. The router is now publicly exposed as "code" at `code.no-panic.org` instead of `opencode-router.no-panic.org`.

**Key Changes:**
- Removed ~55 lines of opencode app setup code
- Renamed public-facing domain from opencode-router to code
- Kept internal Kubernetes names for stability (opencode-router namespace still used)
- Maintained backward compatibility with opencode config namespace
- All TypeScript types check correctly

## Key Decisions
1. Keep the config namespace as "opencode" for backward compatibility - we're only removing one app, not all opencode functionality
2. The `opencode-cloudflare-operator` is tightly coupled with opencode-router and should be kept
3. Remove the simple `opencode` app package entirely (not used, not needed)

## Files to Modify
1. **src/index.ts** - Remove opencode import and usage, rename router references
2. **Pulumi.dev.yaml** - Keep opencode config for router, can remove opencodeImage if simple app removed
3. **packages/apps/opencode-router/package.json** - May need name updates if exporting as "code"
4. Consider: Search repo for "opencode" references that hardcode the name in labels, annotations

## Notes
- Current: `opencode` (ExposedWebApp) and `opencode-router` (dynamic per-user)
- The operator creates session pods with format: `opencode-session-<hash>-app` and `opencode-session-<hash>-signin`
- These internal names can stay as-is for now (they're implementation details)
- Focus on public-facing names: route hostnames and exported URLs

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
