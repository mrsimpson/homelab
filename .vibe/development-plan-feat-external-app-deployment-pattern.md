# Development Plan: homelab (feat/external-app-deployment-pattern branch)

*Generated on 2026-05-11 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal
Create a `homelab-apps` monorepo pattern that:
- Centralises all personal app deployments in one place (single kubeconfig/secret surface)
- Keeps the `homelab` core repo lean and framework-focused (forkable without opinionated apps)
- Avoids maintaining forks of upstream projects just to carry deployment code
- Leverages the existing reusable `deploy-to-cluster.yml` workflow

## Key Decisions

### Decision 1: `homelab-apps` dedicated monorepo
A separate GitHub repo (`homelab-apps`) acts as the personal deployment registry.
Each app is a Pulumi project under `apps/<name>/`, consuming `@mrsimpson/homelab-core-components` from npm
and referencing the base infra via `StackReference("mrsimpson/homelab/dev")`.

Rationale:
- One repo = one secret set (KUBECONFIG, TS_OAUTH_CLIENT_ID/SECRET, PULUMI_ACCESS_TOKEN)
- Single `package-lock.json` and Renovate/Dependabot scope
- No upstream fork needed — lobehub (and future apps) are referenced by published image, not source

### Decision 2: No Dockerfile in homelab-apps
The lobehub Dockerfile is identical to upstream → no custom image needed.
Use the official `ghcr.io/lobehub/lobe-chat` image directly; remove the build workflow from the fork.

### Decision 3: lobehub fork becomes upstream-tracking only
After migration:
- Fork keeps NO deployment code — `deployment/` folder removed
- Fork only exists to track upstream and receive upstream PRs
- Eventually can be deleted if no customisation is needed at all

### Decision 4: homelab core repo stays as-is for demo apps
`packages/apps/hello-world` and `nodejs-demo` remain as examples/demos showing framework usage.
README updated to document the `homelab-apps` pattern as the recommended path for real apps.

### Decision 7: Security hardening (post-validation)
After a security review, three practical fixes were applied (OIDC federation deferred as a future project):
1. **ClusterRole split**: `homelab-ci-deployer` no longer includes `secrets` or `rolebindings`.
   A per-namespace `Role homelab-ci-secrets` is created by `create-kubeconfig.sh` alongside
   the ClusterRoleBinding. Secrets blast radius limited to the app's own namespace.
2. **Explicit secrets map**: `deploy-lobehub.yml` (and all future app workflows) must use
   an explicit `secrets:` block — NOT `secrets: inherit` — to prevent future repo secrets
   from leaking into the reusable workflow.
3. **SHA-pinned reusable workflow**: `@main` replaced with a specific commit SHA.
   Comment in the workflow explains when/how to update it.
4. **Kubeconfig shredded**: `setup-homelab-apps.sh` shreds or removes the `/tmp` kubeconfig
   file immediately after uploading to GitHub secrets.
5. **Per-app KUBECONFIG secrets** recommended: each app should have its own secret
   (e.g. `KUBECONFIG_LOBEHUB`) rather than a shared `KUBECONFIG`.

### Decision 8: Agent skill for adding new apps
`skills/deploy-homelab-app/SKILL.md` (agentskills.io format) replaces the earlier how-to doc.
Covers the full process from scaffolding to CI, including the RBAC model table, per-app secret
naming convention, and security notes. Linked from README.
The how-to doc (`docs/howto/add-new-app-to-homelab-apps.md`) was deleted once the skill was written.

GitHub's API is **write-only** for secret values — we cannot read them back via the API.
However we have all sources available locally:

| Secret | Source |
|---|---|
| `PULUMI_ACCESS_TOKEN` | `~/.pulumi/credentials.json` (already present) |
| `KUBECONFIG` | Generated fresh via `scripts/create-kubeconfig.sh lobehub` |
| `TS_OAUTH_CLIENT_ID` | Must be provided by user (from Tailscale admin console — cannot be automated) |
| `TS_OAUTH_CLIENT_SECRET` | Must be provided by user (from Tailscale admin console — cannot be automated) |

A `scripts/setup-homelab-apps.sh` script will:
1. Create the `homelab-apps` GitHub repo (via `gh repo create`)
2. Extract `PULUMI_ACCESS_TOKEN` from `~/.pulumi/credentials.json` and set it via `gh secret set`
3. Generate a fresh namespace-scoped kubeconfig via `create-kubeconfig.sh lobehub`, base64-encode it, and set as `KUBECONFIG`
4. Prompt interactively for `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_CLIENT_SECRET` (user must supply from Tailscale admin console)

This is a one-time bootstrap script, not a recurring workflow.

### Decision 6: `homelab-apps` workspace structure
```
homelab-apps/
├── package.json          ← npm workspaces root, shared devDeps
├── package-lock.json     ← single lockfile
├── tsconfig.base.json    ← shared compiler options
├── apps/
│   └── lobehub/
│       ├── Pulumi.yaml   ← name: lobehub
│       ├── Pulumi.dev.yaml
│       ├── src/
│       │   ├── index.ts  ← migrated from lobehub fork deployment/homelab/src/
│       │   └── models.ts
│       ├── package.json
│       └── tsconfig.json
└── .github/
    └── workflows/
        └── deploy-lobehub.yml   ← calls mrsimpson/homelab/.github/workflows/deploy-to-cluster.yml
```

## Notes

### Current state
- `homelab` core repo: framework (core-components published to npm @0.2.2), demo apps, reusable CI workflow
- lobehub fork (`~/projects/open-source/lobehub`): full upstream fork + `deployment/homelab/` subtree
  - `deployment/homelab/src/index.ts` + `models.ts` — the actual Pulumi stack
  - `deployment/homelab/Pulumi.dev.yaml` — stack config with encrypted secrets
  - `deployment/homelab/images/lobehub/` — custom Dockerfile (same as upstream → can be dropped)
  - `.github/workflows/build-lobehub-image.yml` — builds custom image (no longer needed)
  - `.github/workflows/deploy-homelab.yml` — calls `mrsimpson/homelab/.../deploy-to-cluster.yml`
- `@mrsimpson/homelab-core-components` is already published to npm (used by lobehub deployment)
- `deploy-to-cluster.yml` is already a reusable `workflow_call` — the building block is ready

### What needs to be built
1. `scripts/setup-homelab-apps.sh` — bootstrap script: creates GH repo + sets all secrets
2. Scaffold `homelab-apps` repo structure (in a local directory, then pushed)
3. Migrate lobehub deployment src + config into `apps/lobehub/`
4. Add GitHub Actions workflow for lobehub deploy
5. Update `homelab` core README to document the pattern
6. Clean up lobehub fork (remove deployment folder, build workflow)

## Explore
<!-- beads-phase-id: homelab-10.1 -->
### Tasks
<!-- beads-synced: 2026-05-11 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Plan
<!-- beads-phase-id: homelab-10.2 -->

### Implementation Design

#### `homelab-apps` repo layout
```
homelab-apps/
├── package.json               ← npm workspaces: ["apps/*"], shared devDeps (typescript, @types/node)
├── package-lock.json          ← single lockfile
├── tsconfig.base.json         ← shared compiler options (strict, ES2022, commonjs, etc.)
├── .gitignore                 ← node_modules, dist/, *.js (compiled)
├── apps/
│   └── lobehub/
│       ├── Pulumi.yaml        ← name: lobehub (unchanged from fork)
│       ├── Pulumi.dev.yaml    ← migrated from fork (all encrypted secrets intact)
│       ├── src/
│       │   ├── index.ts       ← migrated from fork deployment/homelab/src/index.ts
│       │   └── models.ts      ← migrated from fork deployment/homelab/src/models.ts
│       ├── package.json       ← name: @homelab-apps/lobehub, deps: @mrsimpson/homelab-core-components
│       └── tsconfig.json      ← extends ../../tsconfig.base.json
└── .github/
    └── workflows/
        └── deploy-lobehub.yml ← calls mrsimpson/homelab/.github/workflows/deploy-to-cluster.yml@main
```

#### deploy-lobehub.yml trigger design
- `push` on `main` when `apps/lobehub/**` changes
- `workflow_dispatch` with optional image override
- `working-directory: apps/lobehub`
- `pulumi-stack: mrsimpson/lobehub/dev`
- No `workflow_run` trigger (no custom image build needed)

#### `scripts/setup-homelab-apps.sh` design
```bash
#!/usr/bin/env bash
# 1. gh repo create mrsimpson/homelab-apps --public --description "..."
# 2. Extract PULUMI_ACCESS_TOKEN from ~/.pulumi/credentials.json
#    → gh secret set PULUMI_ACCESS_TOKEN -R mrsimpson/homelab-apps
# 3. Generate namespace-scoped KUBECONFIG:
#    bash scripts/create-kubeconfig.sh lobehub
#    base64-encode /tmp/lobehub-ci.kubeconfig
#    → gh secret set KUBECONFIG -R mrsimpson/homelab-apps
# 4. read -s "Enter TS_OAUTH_CLIENT_ID: " TS_CLIENT_ID
#    → gh secret set TS_OAUTH_CLIENT_ID -R mrsimpson/homelab-apps
# 5. read -s "Enter TS_OAUTH_CLIENT_SECRET: " TS_CLIENT_SECRET
#    → gh secret set TS_OAUTH_CLIENT_SECRET -R mrsimpson/homelab-apps
```

#### Migration steps (ordered)
1. Write `scripts/setup-homelab-apps.sh` (repo creation + secret bootstrap)
2. Scaffold root (`package.json`, `tsconfig.base.json`, `.gitignore`) in a new local dir
3. Create `apps/lobehub/` with `package.json` and `tsconfig.json`
4. Copy `src/index.ts` + `src/models.ts` from fork
5. Copy `Pulumi.yaml` + `Pulumi.dev.yaml` from fork
6. Write `deploy-lobehub.yml`
7. Verify `working-directory` and `pulumi-stack` values match
8. Clean lobehub fork (remove `deployment/`, remove `build-lobehub-image.yml`)
9. Update homelab README

#### Lobehub fork cleanup plan
Files/folders to remove from fork:
- `deployment/` (entire subtree)
- `.github/workflows/build-lobehub-image.yml`
- `.github/workflows/deploy-homelab.yml`

After cleanup the fork is a pure upstream tracking fork — no divergence except perhaps the default branch setting.

### Tasks
<!-- beads-synced: 2026-05-11 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [ ] `homelab-10.2.1` Scaffold homelab-apps repo structure (package.json workspace, tsconfig.base.json, .gitignore)
- [ ] `homelab-10.2.2` Migrate lobehub deployment: copy src/index.ts + src/models.ts + Pulumi.yaml + Pulumi.dev.yaml into apps/lobehub/
- [ ] `homelab-10.2.3` Create apps/lobehub/package.json and tsconfig.json with correct relative paths
- [ ] `homelab-10.2.4` Write .github/workflows/deploy-lobehub.yml calling reusable deploy-to-cluster.yml
- [ ] `homelab-10.2.5` Verify lobehub stack config: update working-directory in workflow (apps/lobehub) and pulumi-stack ref
- [ ] `homelab-10.2.6` Clean up lobehub fork: remove deployment/ folder and build-lobehub-image.yml workflow
- [ ] `homelab-10.2.7` Update homelab core README to document homelab-apps pattern
- [ ] `homelab-10.2.8` Write setup-homelab-apps-secrets.sh script that creates the homelab-apps repo and copies/generates all required secrets

## Code
<!-- beads-phase-id: homelab-10.3 -->

### Implementation notes

#### Actual image reference (corrected)
The fork's `Pulumi.dev.yaml` had `ghcr.io/mrsimpson/lobehub:2.1.52-main.b22f4f1` (custom build).
Initial migration used `ghcr.io/lobehub/lobe-chat:v1.74.9` — but lobehub publishes to **Docker Hub**,
not GHCR, and uses version tags without a `v` prefix. Correct reference: `lobehub/lobehub:2.1.57`.

#### CI SA needs ClusterRole not namespace Role
The namespace-scoped `Role` created by `create-kubeconfig.sh` lacked permissions for:
- `namespaces` (cluster-scoped resource, GET needed for Pulumi refresh)
- `traefik.io` (Middleware, IngressRoute CRDs)
- `postgresql.cnpg.io` (Cluster CRD)
- `external-secrets.io` (ExternalSecret CRD)
- `persistentvolumeclaims`

Fix: replaced Role + RoleBinding with `ClusterRole` (`homelab-ci-deployer`) + `ClusterRoleBinding`.
The ClusterRole covers all API groups needed by homelab-apps. ClusterRoleBinding is named
`homelab-ci-deployer:<namespace>:<sa>` to allow multiple apps with separate SAs.
**Decision**: For a monorepo CI setup, a ClusterRole is cleaner than duplicating namespace Roles.
Applied to live cluster and `create-kubeconfig.sh` updated; cherry-picked to `main`.

#### DB migration permission fix (drizzle schema)
After version upgrade (1.x → 2.1.57), LobeHub's Drizzle migration failed:
`permission denied for sequence __drizzle_migrations_id_seq` (PG error 42501).
Root cause: the migration tracking table/sequence in the `drizzle` schema was created
by the `postgres` bootstrap user, not the `app` user. The `app` user had no USAGE grant.
**Fix applied to live cluster**: `ALTER TABLE drizzle.__drizzle_migrations OWNER TO app` +
`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA drizzle TO app`.
**Fix in code** (`postInitApplicationSQL`): added `ALTER DEFAULT PRIVILEGES` statements
so any future CNPG cluster bootstrap grants app the right privileges from the start.

#### All 4 secrets now set on mrsimpson/homelab-apps
- `PULUMI_ACCESS_TOKEN` ✅
- `KUBECONFIG` ✅ (server = Tailscale IP of cluster node, via `SERVER_OVERRIDE`)
- `TS_OAUTH_CLIENT_ID` ✅ (set by user)
- `TS_OAUTH_CLIENT_SECRET` ✅ (set by user)

#### CI pipeline validated end-to-end
Run `25674332178` completed successfully: ✅ `Deploy / pulumi up (mrsimpson/lobehub/dev)` in 50s.
Pod `lobehub-fdf87c5-pb22n` is `1/1 Running`, gateway started successfully.

### Tasks
<!-- beads-synced: 2026-05-11 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `homelab-10.3.1` Write scripts/setup-homelab-apps.sh bootstrap script
- [x] `homelab-10.3.10` Set required secrets on homelab-apps GitHub repo
- [x] `homelab-10.3.11` Push fixes to homelab-apps and homelab repos
- [x] `homelab-10.3.2` Scaffold homelab-apps repo structure locally (package.json, tsconfig.base.json, .gitignore)
- [x] `homelab-10.3.3` Create apps/lobehub workspace (package.json, tsconfig.json, Pulumi.yaml, Pulumi.dev.yaml, src/)
- [x] `homelab-10.3.4` Write .github/workflows/deploy-lobehub.yml
- [x] `homelab-10.3.5` Clean lobehub fork: remove deployment/ and build workflow
- [x] `homelab-10.3.6` Update homelab core README to document homelab-apps pattern
- [x] `homelab-10.3.7` Fix jwksKey corruption in homelab-apps Pulumi.dev.yaml
- [x] `homelab-10.3.8` Fix npm cache path: add npm-lock-file-path input to deploy-to-cluster.yml
- [x] `homelab-10.3.9` Fix deploy-lobehub.yml: pass correct cache path and fix update-image-config job

### Decision 10: All app-deployment skills live in homelab-apps
All four skills (`deploy-homelab-app`, `add-app-with-database`, `add-app-with-oauth`,
`add-app-with-secrets`) live in `homelab-apps/skills/`. Even though `deploy-homelab-app`
references a script in the `homelab` repo (`create-kubeconfig.sh`), every step of work
happens in `homelab-apps` or is a one-off CLI call — there is no reason for the skill
to live in the infra repo. The `homelab` repo README links to `homelab-apps/skills/` instead.

The `homelab` repo has no `skills/` directory.

### Decision 11: No local paths or IPs in committed files
No filesystem paths, IP addresses, or machine-specific values may appear as literal
strings in any committed file (scripts, docs, workflows, skills). Use:
- Placeholders in comments: `<tailscale-ip>`, `<owner/repo>`
- Required env vars with no default: `TAILSCALE_IP="${TAILSCALE_IP:-}"` + preflight error
- `tailscale ip -4` as the self-service command for users to discover their own IP

## Commit
<!-- beads-phase-id: homelab-10.4 -->
### Tasks
<!-- beads-synced: 2026-05-11 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

