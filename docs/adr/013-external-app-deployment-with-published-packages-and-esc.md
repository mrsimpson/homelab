# ADR 013: External App Deployment via Published npm Packages and Pulumi ESC

**Status:** Accepted
**Date:** 2026-04-12
**Deciders:** Platform maintainer
**Supersedes:** [ADR 007](./007-separate-app-repositories.md) (refines with concrete secrets/config strategy)

## Context

The homelab Kubernetes cluster is managed by a single Pulumi monorepo. Applications like `opencode-router` and `opencode-cloudflare-operator` currently have their deployment recipes inside this repo (`packages/apps/`), even though their source code and Docker images are built in separate repositories.

This creates a coupling problem: adding, updating, or removing an app always requires changes to the homelab repo. ADR-007 decided on separate repos with published npm packages but left the secrets and configuration strategy undefined. This ADR refines that decision with a concrete implementation plan.

### Requirements

1. **Zero-touch homelab:** Adding a new app must not require changes to the homelab repo.
2. **Type safety:** Deployment code must be TypeScript/Pulumi — no Helm/YAML templating.
3. **No secret duplication:** Shared credentials (Cloudflare API token, etc.) must be managed in one place.
4. **Reuse ExposedWebApp:** External apps should benefit from the existing ~900-line `ExposedWebApp` component (Traefik IngressRoutes, OAuth2-Proxy middleware chains, Cloudflare DNS, ExternalSecrets, Pod Security Standards).

### Integration surface analysis

`ExposedWebApp` (the core component external apps need) depends on:
- **Infrastructure facts** (Cloudflare zone ID, tunnel CNAME, tunnel ID, domain) — currently read from `homelabConfig` or injected via `HomelabContext`
- **Cluster-resident services** (Traefik, oauth2-proxy, ExternalSecrets operator, cert-manager) — must exist but need no code reference
- **Secrets** (Cloudflare API token for DNS record creation) — currently in homelab's encrypted `Pulumi.dev.yaml`

## Decision

**Publish `@mrsimpson/homelab-core-components` to the public npmjs.com registry. External app repos use it in their own Pulumi stacks, reading shared infrastructure outputs via Pulumi StackReference and shared secrets via Pulumi ESC environments.**

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Pulumi ESC                        │
│  Environment: homelab/shared                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ cloudflare-api-token, cloudflare-zone-id,      │  │
│  │ domain, tunnel-cname, anthropic-api-key, ...   │  │
│  └────────────────────────────────────────────────┘  │
│           ▲                      ▲                   │
│      imports                imports                  │
│  Pulumi.dev.yaml          Pulumi.dev.yaml            │
│  (homelab stack)          (external app stack)       │
└──────────────────────────────────────────────────────┘

┌───────────────────┐       ┌─────────────────────────┐
│  homelab repo     │       │  external app repo      │
│                   │       │                         │
│  publishes:       │       │  npm install:           │
│  @mrsimpson/      │──────▶│  @mrsimpson/            │
│  homelab-core-    │  npm  │  homelab-core-components│
│  components       │       │                         │
│                   │       │  deploy/index.ts:       │
│  Stack outputs:   │       │  - StackRef → infra     │
│  tunnelId,        │◀──────│  - ESC → secrets        │
│  tunnelCname, ... │ read  │  - createExposedWebApp()│
└───────────────────┘       └─────────────────────────┘
```

### Three-layer configuration model

| Layer | Examples | Mechanism | Managed by |
|---|---|---|---|
| **Shared infra facts** | tunnelCname, tunnelId, domain | Pulumi StackReference (read-only from homelab stack outputs) | Homelab repo |
| **Shared secrets** | Cloudflare API token, GHCR credentials | Pulumi ESC environment (`homelab/shared`) | Homelab maintainer (once) |
| **App-specific config** | routerImage, storageSize, anthropicApiKey | App's own `Pulumi.dev.yaml` | App repo |

## Pugh Decision Matrix

Evaluation of three viable approaches against the requirements. Scores: +1 (better than baseline), 0 (same), -1 (worse). Baseline: current state (deployment recipes in homelab monorepo).

| Criterion (weight) | A: Published npm + ESC | B: GitOps (ArgoCD) + Helm | C: GitOps (ArgoCD) + Pulumi K8s Operator |
|---|---|---|---|
| Zero-touch homelab (5) | +1 | +1 | +1 |
| Type safety (4) | +1 | -1 | +1 |
| No secret duplication (3) | +1 | +1 | +1 |
| Reuse ExposedWebApp (4) | +1 | -1 | +1 |
| Implementation effort (3) | +1 | -1 | -1 |
| No cluster creds in CI (2) | -1 | +1 | +1 |
| Industry-standard pattern (1) | 0 | +1 | 0 |
| **Weighted total** | **+16** | **-4** | **+8** |

### Score breakdown

- **A (Published npm + ESC):** Wins on type safety, reuse, and effort. Only downside: external repos need KUBECONFIG + PULUMI_ACCESS_TOKEN in CI.
- **B (ArgoCD + Helm):** Eliminates CI cluster credentials but requires rebuilding ExposedWebApp as Helm templates (~900 lines of Go templating). Contradicts ADR-001 (type safety).
- **C (ArgoCD + Pulumi Operator):** Best of both worlds in theory, but the [Pulumi Kubernetes Operator](https://www.pulumi.com/docs/iac/using-pulumi/continuous-delivery/pulumi-kubernetes-operator/) adds significant operational complexity (operator deployment, CRD management, stack CR lifecycle) for marginal benefit over Option A.

## Rationale

### Why published npm packages?

- `ExposedWebApp` encapsulates ~900 lines of Traefik IngressRoute, OAuth2-Proxy middleware, Cloudflare DNS, ExternalSecrets, and Pod Security Standards wiring. Rebuilding this in Helm or any other tool is wasteful.
- TypeScript npm packages are a natural extension of the existing architecture (ADR-001, ADR-004).
- ADR-007 already decided on this direction; this ADR adds the missing secrets strategy.

### Why Pulumi ESC for secrets?

- The homelab already uses Pulumi ESC as a secrets backend (ClusterSecretStore `pulumi-esc`).
- ESC environments can be shared across stacks without copying secret values.
- Avoids the alternative: duplicating `cloudflare:apiToken` in every external repo's Pulumi config.

### Why StackReference for infra facts?

- Infrastructure facts (tunnel IDs, CNAMEs) are outputs of `pulumi up` — not static config.
- StackReference is a read-only API call to Pulumi Cloud, requiring only `PULUMI_ACCESS_TOKEN`.
- No direct coupling: the external stack doesn't import homelab code, just reads its outputs.

## Implementation

### Homelab repo (one-time changes)

1. **Publish `@mrsimpson/homelab-core-components`** to npmjs.com via GitHub Actions on push to `main` when `packages/core/components/` changes.
2. **Export additional stack outputs** in `src/index.ts`:
   ```typescript
   export const cloudflareZoneId = homelabConfig.cloudflare.zoneId;
   export const domain = homelabConfig.domain;
   ```
3. **Create Pulumi ESC environment** `homelab/shared` containing shared secrets (Cloudflare API token, etc.).
4. **Refactor `homelabConfig`**: Make values injectable (constructor args or StackReference) rather than always reading from the calling stack's `pulumi.Config()`.

### External app repo (per-app, repeatable)

1. `npm install @mrsimpson/homelab-core-components`
2. Create `Pulumi.yaml` + `Pulumi.dev.yaml` with ESC environment import
3. Write `index.ts` using `HomelabContext` + `createExposedWebApp()`
4. CI pipeline: `npm install` → `pulumi up` (needs `PULUMI_ACCESS_TOKEN` + `KUBECONFIG`)

## Consequences

### Positive

- Apps are fully autonomous — own repo, own CI/CD, own Pulumi stack
- Type-safe deployment code with IDE autocomplete
- Shared secrets managed in one place (Pulumi ESC)
- ExposedWebApp abstraction reused without duplication
- Apps can pin to specific component versions (semver)
- Clean app lifecycle: create, experiment, delete the repo

### Negative

- Each external repo needs `KUBECONFIG` and `PULUMI_ACCESS_TOKEN` as CI secrets
- Publishing step required when core components change (semver overhead)
- Multiple Pulumi stacks managing the same cluster (need care to avoid conflicts)
- External repos depend on homelab stack being up and outputs being current

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Breaking change in published package | Semver + apps pin to major version |
| Cluster credential leakage from external CI | Use scoped kubeconfig (namespace-limited RBAC) per app |
| Pulumi state conflicts (two stacks touching same resource) | Convention: apps own their namespace, homelab owns shared infra |

## Alternatives Considered

See Pugh matrix above. Options B (Helm/GitOps) and C (Pulumi K8s Operator) were evaluated and scored lower.

## References

- [ADR 001: Pulumi over YAML](./001-pulumi-over-yaml.md) — type safety rationale
- [ADR 004: Component Pattern](./004-component-pattern.md) — ExposedWebApp design
- [ADR 007: Separate App Repositories](./007-separate-app-repositories.md) — original decision (refined here)
- [ADR 008: Secrets Management](./008-secrets-management.md) — existing secrets approach
- [Pulumi StackReference docs](https://www.pulumi.com/docs/concepts/stack/#stackreferences)
- [Pulumi ESC docs](https://www.pulumi.com/docs/esc/)
- [npmjs.com: @mrsimpson/homelab-core-components](https://www.npmjs.com/package/@mrsimpson/homelab-core-components)
