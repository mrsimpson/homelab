# Development Plan: homelab (opencode-router branch)

*Generated on 2026-04-02 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal

Deploy the `opencode-router` and `opencode-router-app` packages (from `~/projects/open-source/opencode`) as a new homelab application.

The router provides per-user isolated OpenCode instances on Kubernetes: each authenticated user gets their own Pod + PVC, managed dynamically via the K8s API. The router sits between oauth2-proxy and the per-user pods, reading `X-Auth-Request-Email` to identify users.

This is additive — the existing single-user `opencode` deployment stays unchanged.

---

## Key Decisions

- **New package `packages/apps/opencode-router/`** — follows the same pattern as `packages/apps/opencode/`. Exports a `createOpencodeRouter(homelab, cfg)` function.
- **Does NOT use `ExposedWebApp`** — needs raw K8s resources (ServiceAccount, Role, RoleBinding, Secret, ConfigMap, Deployment, Service, IngressRoutes) plus RBAC not covered by the abstraction. The Traefik routing pattern is replicated manually.
- **Image build** — `images/opencode-router/build.sh` (mirrors `images/opencode/build.sh`), built from `~/projects/open-source/opencode` monorepo root, pushed to `ghcr.io/mrsimpson/opencode-router:<version>`.
- **Separate namespace `opencode-router`** — avoids Pulumi conflict with the existing `opencode` app's namespace. All router resources and per-user pods/PVCs land here.
- **Namespace PSS: `restricted`** — user pods get a full securityContext (UID 1000, fsGroup 1000, non-root, drop ALL caps, RuntimeDefault seccomp) via a fix to `pod-manager.ts` in the opencode fork. No `privileged` namespace needed.
- **`OPENCODE_IMAGE` = `ghcr.io/mrsimpson/opencode` (our hardened image)** — the securityContext fix in `pod-manager.ts` makes UID 1000 + PVC work correctly. Custom tools (gh, bd, ghostty) are available in user pods.
- **Auth** — same oauth2-proxy + Traefik pattern as existing apps: ForwardAuth + Errors + Chain middlewares + two IngressRoutes.
- **API keys** — `opencode-api-keys` Secret in `opencode-router` namespace; ANTHROPIC_API_KEY from Pulumi config secret.
- **ConfigMap** — `opencode-config-dir` ConfigMap; contains `opencode.json` (shared config for all per-user pods).
- **StorageClass** — `longhorn-uncritical`, 2Gi per user PVC (set via `STORAGE_CLASS` / `STORAGE_SIZE` env vars on router).
- **Domain** — `opencode-router.no-panic.org` (new subdomain).
- **The existing `opencode` app is unchanged**.
- **Cloudflare DNS wiring** — `zoneId` comes from `homelabConfig.cloudflare.zoneId` (config package), `tunnelCname` from `baseInfra.cloudflare.tunnelCname` (stack return). `HomelabContext` does not expose cloudflare directly, so `CloudflareConfig` is passed as optional `cfg.cloudflare` field (same pattern as `ExposedWebApp`).
- **`OpencodeRouterConfig.cloudflare`** — optional field; when omitted, no DNS record is created. When provided, creates Cloudflare CNAME for `opencode-router.<domain>`.
- **Pulumi config keys** — `opencode:routerImage` and `opencode:opencodeImage` added to `Pulumi.dev.yaml` (gitignored; set locally). `opencode:anthropicApiKey` was already set.
- **`OPENCODE_PORT` env var on router** — passed as `String(4096)` in Deployment env; router uses it to bind per-user pods on port 4096.
- **ADR-002 in opencode fork** — documents the securityContext decision for future contributors.

---

## Notes

### opencode-router architecture

```
Internet → Traefik → oauth2-proxy ForwardAuth → opencode-router (port 3000) → per-user Pod (opencode serve :4096)
```

The router reads `X-Auth-Request-Email`, hashes email → `opencode-user-<hash>` pod name / `opencode-pvc-<hash>` PVC name. Serves setup SPA when no pod exists; proxies HTTP+WebSocket when pod is running.

### Static Pulumi resources (in namespace `opencode`)

1. `Namespace` — `opencode`
2. `ServiceAccount` — `opencode-router`
3. `Role` — `opencode-router` (pods: get/list/create/delete/patch; pvcs: get/list/create)
4. `RoleBinding` — `opencode-router`
5. `Secret` — `opencode-api-keys` (ANTHROPIC_API_KEY)
6. `ConfigMap` — `opencode-config-dir` (opencode.json)
7. `Deployment` — `opencode-router` (2 replicas, env: OPENCODE_IMAGE, STORAGE_CLASS, STORAGE_SIZE, DEFAULT_GIT_REPO, ...)
8. `Service` — `opencode-router` (ClusterIP, port 80 → 3000)
9. Traefik `Middleware` ForwardAuth — checks oauth2-proxy session, passes `X-Auth-Request-Email`
10. Traefik `Middleware` Errors — catches 401 → oauth2 redirect
11. Traefik `Middleware` Chain — errors + forwardauth
12. Traefik `IngressRoute` (signin) — `/oauth2/*` → oauth2-proxy (unprotected)
13. Traefik `IngressRoute` (app) — `/*` → opencode-router Service (protected by chain)
14. Cloudflare DNS Record — `opencode-router.no-panic.org` CNAME

Dynamic resources (created by router at runtime, NOT Pulumi-managed):
- Per-user PVCs and Pods

### Config variables (Pulumi config under `opencode` namespace)

| Pulumi config key | Required | Description |
|---|---|---|
| `opencode:anthropicApiKey` | Yes (secret) | Already set |
| `opencode:routerImage` | Yes | `ghcr.io/mrsimpson/opencode-router:<tag>` |
| `opencode:opencodeImage` | Yes | `ghcr.io/mrsimpson/opencode:<tag>` (same as current) |
| `opencode:defaultGitRepo` | No | Git repo to auto-clone for new users |
| `opencode:storageSize` | No | PVC size per user (default 2Gi) |

---

## Explore
<!-- beads-phase-id: homelab-4.1 -->
### Tasks
<!-- beads-synced: 2026-04-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `homelab-4.1.1` Understand opencode-router package structure and Dockerfile
- [x] `homelab-4.1.2` Understand opencode-router-app (SPA) package
- [x] `homelab-4.1.3` Review deployment guide (docs/deployment.md)
- [x] `homelab-4.1.4` Understand existing homelab deployment patterns (ExposedWebApp, packages/apps/opencode)
- [x] `homelab-4.1.5` Determine what Pulumi resources are needed for the router deployment
- [x] `homelab-4.1.6` Determine image build strategy for opencode-router

## Plan
<!-- beads-phase-id: homelab-4.2 -->
### Phase Entrance Criteria
- [x] Goal and scope clearly defined
- [x] All required Kubernetes resources identified
- [x] Image build strategy understood
- [x] Auth/routing pattern understood (oauth2-proxy + Traefik IngressRoute)
- [x] Existing homelab patterns understood (package structure, ExposedWebApp)

### Issues Identified & Resolutions

#### Issue 1 — SECURITY: User pod securityContext missing → PVC permission failure with UID 1000 (REQUIRES SOURCE FIX)

The router's `pod-manager.ts` creates user pods **without any securityContext**. Our hardened homelab image (`ghcr.io/mrsimpson/opencode`) runs as UID 1000, `HOME=/root`. A fresh PVC mounted at `/root` is owned by root (UID 0) by default — UID 1000 cannot write to it without `fsGroup: 1000` being set on the pod spec.

**Resolution: fix `pod-manager.ts` in the opencode-router source** to add securityContext to the user pod spec:

```ts
spec: {
  securityContext: {
    runAsUser: 1000,
    runAsGroup: 1000,
    fsGroup: 1000,           // ← makes the PVC owned by GID 1000 on mount
    runAsNonRoot: true,
  },
  containers: [{
    securityContext: {
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
    },
    ...
  }]
}
```

The init container (`alpine/git`) also needs a securityContext if it writes to the PVC subPath. Since it writes to `/workspace` (subPath `projects`) and the PVC fsGroup is 1000, it must also run as UID 1000 — or the git-init container writes as root and that subdir becomes root-owned. Fix: add the same UID/GID to the init container, **or** change the init container to `chown -R 1000:1000 /workspace` after clone. Simpler: set `runAsUser: 1000` on the init container too.

This fix belongs in `~/projects/open-source/opencode/packages/opencode-router/src/pod-manager.ts`.

#### Issue 5 — SECURITY: Namespace PSS must NOT be `privileged`

With the securityContext fix above, user pods run as non-root (UID 1000), drop all capabilities, and use `RuntimeDefault` seccomp. This fully satisfies **`restricted` PSS**. No `privileged` level needed.

**Resolution: namespace PSS set to `restricted`** — the strictest level. This is the correct and secure choice. Update the plan accordingly.

#### Issue 2 — SECURITY: `X-Auth-Request-Email` header trust

The router trusts `X-Auth-Request-Email` without verification. If the router Service were reachable directly, any caller could impersonate any user.

**Resolution:** Service is `ClusterIP` — only reachable via Traefik ForwardAuth chain. Acceptable for homelab. ✅

#### Issue 3 — SECURITY: Shared API keys across all users

All user pods share one `opencode-api-keys` Secret. No per-user budget enforcement.

**Resolution:** Documented design decision (ADR-001). Acceptable for trusted team. ✅

#### Issue 4 — AVAILABILITY: 2-replica activity throttle cache is in-memory

With 2 replicas, each has its own `activityThrottle` Map. Annotation writes may happen slightly more often.

**Resolution:** Documented as acceptable ("non-critical"). ✅

#### Issue 6 — AVAILABILITY: WebSocket connection timeouts

OpenCode uses WebSockets for PTY. Traefik default timeouts may drop idle connections.

**Resolution:** The existing `opencode` app works via the same Traefik setup. ✅

#### Summary of plan changes from this review

- **Fix `pod-manager.ts`** in `~/projects/open-source/opencode` to add full securityContext (UID 1000, fsGroup 1000, non-root, drop ALL caps, RuntimeDefault seccomp) to both init containers and main container of user pods
- **Namespace PSS → `restricted`** (not `privileged`) — user pods with proper securityContext satisfy restricted PSS
- **`OPENCODE_IMAGE`** → keep using `ghcr.io/mrsimpson/opencode` (our hardened image with custom tools) — this is the correct image now that the securityContext fix makes UID 1000 + PVC work
- **Config key** → `opencode:opencodeImage` (unchanged)

---

### Implementation Plan

#### Key architectural decision: namespace

The existing `opencode` app already owns namespace `opencode`. Using the same namespace would create a Pulumi conflict.

**Decision: router uses namespace `opencode-router`** for all Pulumi-managed resources, with `OPENCODE_NAMESPACE=opencode-router` so per-user Pods/PVCs land there too.

#### Step 0 — Fix `pod-manager.ts` in the opencode fork (source change)

File: `~/projects/open-source/opencode/packages/opencode-router/src/pod-manager.ts`

Add to the pod spec inside `ensurePod()`:

```ts
spec: {
  restartPolicy: "Always",
  // Pod-level security: fsGroup ensures PVC mounted at /root is group-owned by GID 1000
  securityContext: {
    runAsUser: 1000,
    runAsGroup: 1000,
    fsGroup: 1000,
    runAsNonRoot: true,
  },
  initContainers: initContainers.length > 0 ? initContainers : undefined,
  containers: [{
    ...
    securityContext: {
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
    },
  }],
}
```

And for the `git-init` init container, add the same UID:
```ts
{
  name: "git-init",
  securityContext: {
    runAsUser: 1000,
    runAsGroup: 1000,
    allowPrivilegeEscalation: false,
    runAsNonRoot: true,
    capabilities: { drop: ["ALL"] },
  },
  ...
}
```

This makes user pods fully `restricted` PSS-compliant and allows UID 1000 to write to the PVC.

#### Step 1 — Image build script: `images/opencode-router/build.sh`

- Mirrors `images/opencode/build.sh` structure
- Build context: `~/projects/open-source/opencode` (monorepo root)
- Dockerfile: `packages/opencode-router/Dockerfile`
- Version read from `packages/opencode-router/package.json` (`.version` field) via `node -p`
- Push target: `ghcr.io/mrsimpson/opencode-router:<version>-homelab.<revision>`

#### Step 2 — New package: `packages/apps/opencode-router/`

Files:
```
packages/apps/opencode-router/
  package.json          # @mrsimpson/homelab-app-opencode-router
  tsconfig.json         # extends ../../../tsconfig.json
  src/
    index.ts            # exports createOpencodeRouter + OpencodeRouterConfig
```

`package.json` deps: `@mrsimpson/homelab-core-components`, `@mrsimpson/homelab-config`, `@pulumi/kubernetes`, `@pulumi/pulumi` (peer)

#### Step 3 — `src/index.ts` — resource creation order

All resources in namespace `opencode-router`:

1. `Namespace` — `opencode-router` (**PSS: `restricted`** — user pods with proper securityContext are fully compliant)
2. `ServiceAccount` — `opencode-router`
3. `Role` — `opencode-router`:
   - `pods`: get, list, create, delete, patch
   - `persistentvolumeclaims`: get, list, create
4. `RoleBinding` — binds Role → ServiceAccount
5. `Secret` — `opencode-api-keys` (type Opaque, `ANTHROPIC_API_KEY`)
6. `ConfigMap` — `opencode-config-dir`:
   - key `opencode.json`: minimal model config (claude-sonnet-4-5 default)
7. `ExternalSecret` — `ghcr-pull-secret` (same pattern as ExposedWebApp)
8. `Deployment` — `opencode-router`:
   - replicas: 2
   - serviceAccountName: `opencode-router`
   - imagePullSecrets: `[ghcr-pull-secret]`
   - env: `OPENCODE_IMAGE`, `OPENCODE_NAMESPACE=opencode-router`, `STORAGE_CLASS=longhorn-uncritical`, `STORAGE_SIZE`, `IDLE_TIMEOUT_MINUTES`, optionally `DEFAULT_GIT_REPO`
   - readiness/liveness: `GET /api/status` with header `X-Auth-Request-Email: healthcheck@probe`
   - resources: requests 100m/128Mi, limits 500m/256Mi
   - securityContext: `runAsUser: 1000`, `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: ALL`
9. `Service` — `opencode-router` (ClusterIP, port 80 → 3000)
10. Traefik `Middleware` — ForwardAuth (oauth2-proxy session check, forward `X-Auth-Request-Email`)
11. Traefik `Middleware` — Errors (401 → redirect via `oauth2-shared-redirect` in `oauth2-proxy` ns)
12. Traefik `Middleware` — Chain (errors + forwardauth)
13. Traefik `IngressRoute` — signin: `/oauth2/*` → oauth2-proxy (unprotected, entryPoint `web`)
14. Traefik `IngressRoute` — app: `/*` → Service (chain middleware, entryPoint `web`)
15. Cloudflare DNS Record — `opencode-router.no-panic.org` CNAME

#### Step 4 — Wire into root `src/index.ts`

- Add `@mrsimpson/homelab-app-opencode-router: "*"` to root `package.json`
- Import and call `createOpencodeRouter(homelab, {...})`
- Read from `opencodeConfig`:
  - `opencodeConfig.require("routerImage")` — the opencode-router image
  - `opencodeConfig.require("opencodeImage")` — the per-user pod image (`ghcr.io/mrsimpson/opencode:...`)
  - `opencodeConfig.requireSecret("anthropicApiKey")` (already set)
  - `opencodeConfig.get("defaultGitRepo")` (optional)
  - `opencodeConfig.get("storageSize")` (optional, default 2Gi)
- Export `opencodeRouterUrl`

#### Step 5 — Pulumi config values to set (documented for user)

```bash
pulumi config set opencode:routerImage "ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.1"
# opencodeImage already set to ghcr.io/mrsimpson/opencode:1.2.27-homelab.5
# anthropicApiKey already set
```

### Tasks
<!-- beads-synced: 2026-04-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `homelab-4.2.1` Plan: Define package structure for packages/apps/opencode-router/
- [x] `homelab-4.2.2` Plan: Define all Pulumi resources and their ordering/dependencies
- [x] `homelab-4.2.3` Plan: Define image build script structure (images/opencode-router/build.sh)
- [x] `homelab-4.2.4` Plan: Define Pulumi config keys needed and wire into src/index.ts

## Code
<!-- beads-phase-id: homelab-4.3 -->
### Phase Entrance Criteria
- [x] Concrete implementation plan with all steps documented
- [x] Pulumi resource list finalised (15 resources, namespace PSS `restricted`)
- [x] Package structure for `packages/apps/opencode-router/` defined
- [x] Config variables and Pulumi config keys defined
- [x] Security and availability issues reviewed and resolved
- [x] Source fix for `pod-manager.ts` specified (securityContext for UID 1000 + fsGroup)

### Tasks
<!-- beads-synced: 2026-04-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `homelab-4.3.1` Fix pod-manager.ts: add securityContext (UID 1000, fsGroup, restricted PSS)
- [x] `homelab-4.3.2` Document pod-manager.ts changes in ADR
- [x] `homelab-4.3.3` Create images/opencode-router/build.sh
- [x] `homelab-4.3.4` Create packages/apps/opencode-router/package.json and tsconfig.json
- [x] `homelab-4.3.5` Create packages/apps/opencode-router/src/index.ts (all K8s resources)
- [x] `homelab-4.3.6` Wire createOpencodeRouter into root src/index.ts and package.json
- [x] `homelab-4.3.7` Set Pulumi config values (routerImage, opencodeImage)
- [x] `homelab-4.3.8` Type-check and lint

## Commit
<!-- beads-phase-id: homelab-4.4 -->
### Phase Entrance Criteria
- [x] All Pulumi code written and type-checks cleanly
- [x] Build script for router image exists (`images/opencode-router/build.sh`)
- [x] `src/index.ts` imports and wires up `createOpencodeRouter`
- [x] Pulumi preview completes without errors — `+ 15 to create, 108 unchanged`, zero errors/warnings

### Tasks
<!-- beads-synced: 2026-04-02 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

