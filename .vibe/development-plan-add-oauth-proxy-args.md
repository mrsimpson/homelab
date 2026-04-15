# Development Plan: homelab (add-oauth-proxy-args branch)

*Generated on 2026-04-15 by Vibe Feature MCP*
*Workflow: [minor](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/minor)*

## Goal

Add `extraArgs?: string[]` to the `OAuth2ProxyConfig` interface in `ExposedWebApp.ts`.

The opencode project requires the ability to pass extra CLI arguments to the oauth2-proxy container (e.g. `--github-org=...`). Currently `OAuth2ProxyConfig` only supports `group` and `namespace` — the config type needs to forward arbitrary additional args.

**Note:** The `ExposedWebApp` component does NOT manage a oauth2-proxy Deployment itself — it only points a Traefik ForwardAuth middleware at the shared, pre-deployed oauth2-proxy service. The `extraArgs` field in `OAuth2ProxyConfig` is therefore for **documentation and future use** only, or needs to be wired into the Helm-layer infrastructure.

**Revised understanding:** The request is to add `extraArgs` to the `OAuth2ProxyConfig` *type* so downstream consumers (like opencode) can pass it through. The infrastructure layer (`oauth2-proxy.ts`) is separate and would need its own change if args should actually be applied to the Helm release. The minimal change here is the type addition.

## Explore
<!-- beads-phase-id: homelab-7.1 -->
### Tasks

- [x] Located `OAuth2ProxyConfig` interface in `packages/core/components/src/ExposedWebApp.ts` (lines 138–143)
- [x] Confirmed `ExposedWebApp` does NOT manage an oauth2-proxy Deployment directly
- [x] Understood the infrastructure layer deploys oauth2-proxy via Helm in `packages/core/infrastructure/src/oauth2-proxy/oauth2-proxy.ts`
- [x] Scope: type-only addition to `OAuth2ProxyConfig`

## Implement
<!-- beads-phase-id: homelab-7.2 -->

### Phase Entrance Criteria:
- [x] The scope of the change is clear (type addition only)
- [x] The target file and interface are identified

### Tasks

- [ ] Add `extraArgs?: string[]` with JSDoc to `OAuth2ProxyConfig` in `ExposedWebApp.ts`

## Finalize
<!-- beads-phase-id: homelab-7.3 -->

### Phase Entrance Criteria:
- [ ] `extraArgs?: string[]` has been added to `OAuth2ProxyConfig`
- [ ] TypeScript compilation succeeds

### Tasks

- [ ] Run TypeScript compilation to verify no errors
- [ ] Commit the change

## Key Decisions

- Scope is limited to the type definition in `OAuth2ProxyConfig` — no wiring into the Helm infrastructure layer is needed for this ticket
- The `ExposedWebApp` component uses the already-deployed oauth2-proxy, it does not create one

## Notes

- `OAuth2ProxyConfig` is at `packages/core/components/src/ExposedWebApp.ts` lines 138–143
- Infrastructure deployment is at `packages/core/infrastructure/src/oauth2-proxy/oauth2-proxy.ts`

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
