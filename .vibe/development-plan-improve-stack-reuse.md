# Development Plan: homelab (improve-stack-reuse branch)

*Generated on 2026-04-21 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal
Improve the adaptability of the ExposedWebApp component to make it easier to consume by addressing:
1. Missing support for `envFrom` in the TypeScript API
2. Complex config parameter handling (e.g., cloudflare-token)
3. Better reusability patterns for common configurations

## Key Decisions
1. **Add `envFrom` to ExposedWebAppArgs** — straightforward, mirrors K8s container spec. Confirmed.
2. **GHCR pull secret should work with pre-created namespaces** — remove the `isCreatingNamespace` guard. Confirmed.
3. **Wildcard DNS instead of per-app records** — Create `*.no-panic.org` CNAME → tunnel in base stack. ExposedWebApp's `cloudflare` config becomes opt-in (only for apps needing explicit records). Eliminates `cloudflare:apiToken` requirement for external consumers.

## Notes
- User has successfully deployed two apps (opencode and lobehub) using ExposedWebApp
- Both apps had to work around missing `envFrom` support by manually creating secrets and using `env` array
- Both apps needed to handle cloudflare-token configuration manually
- Current pattern requires significant boilerplate for common scenarios

## Explore
<!-- beads-phase-id: homelab-8.1 -->
### Tasks
<!-- beads-synced: 2026-04-21 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `homelab-8.1.1` Analyze current ExposedWebApp limitations and usage patterns
- [x] `homelab-8.1.2` Add envFrom support to ExposedWebApp interface
- [x] `homelab-8.1.3` Simplify cloudflare configuration handling
- [x] `homelab-8.1.4` Explore: Understand tunnel routing, DNS records, and Cloudflare provider requirements for external apps

## Plan
<!-- beads-phase-id: homelab-8.2 -->
### Tasks
<!-- beads-synced: 2026-04-21 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Code
<!-- beads-phase-id: homelab-8.3 -->
### Tasks
<!-- beads-synced: 2026-04-21 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `homelab-8.3.1` Add envFrom to ExposedWebAppArgs and wire it into the container spec
- [x] `homelab-8.3.2` Create GHCR pull secret regardless of namespace ownership
- [x] `homelab-8.3.3` Add wildcard DNS record in base-infra cloudflare module
- [x] `homelab-8.3.4` Remove per-app cloudflare.Record from in-repo apps
- [x] `homelab-8.3.5` Bump homelab-core-components version
- [x] `homelab-8.3.6` Type-check and verify
- [x] `homelab-8.3.7` Adapt lobehub app to use envFrom and remove cloudflare:apiToken

## Commit
<!-- beads-phase-id: homelab-8.4 -->
### Tasks
<!-- beads-synced: 2026-04-21 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

