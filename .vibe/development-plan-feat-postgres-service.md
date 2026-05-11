# Development Plan: homelab (feat/postgres-service branch)

*Generated on 2026-05-10 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal

Provide a reusable, centrally-managed PostgreSQL service in Pulumi that:
- Deploys Postgres via the **CloudNativePG (CNPG) operator** — handling HA, failover, WAL archiving and credential generation natively
- Uses Longhorn persistent storage with backup support
- Is expressed as a `PostgresInstance` Pulumi `ComponentResource` — independent of `ExposedWebApp`, composed at the call site
- Is easily consumable by other app stacks (like lobehub) via a clean Pulumi API
- Is designed for PG18 from the start, with `instances: 1 → N` HA upgrade path requiring zero API changes

---

## Explore
<!-- beads-phase-id: homelab-9.1 -->

### Phase Entrance Criteria
*(Initial phase — no prior criteria)*

### Findings

#### Current Homelab Project Structure
- **Project**: TypeScript npm workspaces monorepo, single Pulumi stack `homelab/dev`
- **Entry point**: `src/index.ts` — calls `setupBaseInfra()` → returns `HomelabContext`, then calls per-app factory functions
- **Key abstractions**:
  - `HomelabContext`: DI container holding shared infra config (TLS, gateway, Cloudflare, ESO). Passed to all apps.
  - `ExposedWebApp` (`pulumi.ComponentResource`): assembles Namespace + Deployment + Service + HTTPRoute/IngressRoute + optional PVC + optional DNS record. All user-facing apps use this.
- **Packages**: `packages/core/{config,components,infrastructure}`, `packages/stacks/{base-infra,observability}`, `packages/apps/*`
- **Cross-stack consumption**: External repos (e.g. lobehub) use `pulumi.StackReference` + `createHomelabContextFromStack()` to consume homelab outputs

#### Existing Infra Operator Pattern (cert-manager, ESO, Longhorn)
Each operator follows the same structure:
1. `packages/core/infrastructure/src/<name>/index.ts` — Namespace + Helm Release, exports resources
2. `packages/core/infrastructure/src/index.ts` — `export * from "./<name>"`
3. `packages/stacks/base-infra/src/index.ts` — wired into `infrastructureReady.dependsOn[...]` and exported

CNPG follows exactly this pattern. Helm chart: `cloudnative-pg` from `https://cloudnative-pg.io/charts/`, latest version `0.28.0` (operator `1.29.0`).

#### CNPG Cluster CRD & Generated Secrets
- `kind: Cluster` (apiVersion: `postgresql.cnpg.io/v1`) — operator manages pod lifecycle, Services, WAL archiving
- Auto-creates Secret `<cluster-name>-app` with keys: `username`, `password`, `host`, `port`, `dbname`, `uri`, `jdbc-uri`, `fqdn-uri`, `pgpass`
- Auto-creates Services: `<cluster-name>-rw` (primary), `<cluster-name>-ro` (replicas), `<cluster-name>-r` (all)
- Credentials are CNPG-generated — no `RandomPassword` needed
- `uri` key in CNPG secret = `postgresql://user:pass@host:5432/db` format (note: `postgresql://` not `postgres://`)

#### Credential Key Mismatch — Adapter Secret Required
Apps (lobehub etc.) expect env vars: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`.
CNPG secret has: `dbname`, `username`, `password`, `uri`.
**Solution**: `PostgresInstance` creates a thin adapter `Secret` that re-maps CNPG's keys to the canonical env var names. The adapter is populated via Pulumi by reading from the CNPG secret output — CNPG secrets are plain K8s Secrets, so Pulumi can read them as `k8s.core.v1.Secret` and map their `.data` fields.

Actually: the cleaner approach is to use CNPG's `bootstrap.initdb.secret.name` to pre-supply credentials (CNPG will use them), OR simply build the adapter Secret using Pulumi `Output` interpolation from the CNPG-generated secret. The latter is more idiomatic Pulumi — we reference the CNPG secret object and project its fields.

#### CNPG + ParadeDB Image Compatibility
- CNPG requires image tags to start with the PG major version (e.g. `18.x`) — floating `latest-pg18` tag works for homelab
- `paradedb/paradedb:latest-pg18` is CNPG-compatible (based on official postgres image)
- Extensions (`pgvector`, `pg_search`) are baked in — lobehub migrations do `CREATE EXTENSION IF NOT EXISTS` which works fine
- CNPG's `imageName` field in `Cluster` spec replaces our `image` arg

#### Existing Postgres (LobeHub) — Current State
- **Location**: `~/projects/open-source/lobehub/deployment/homelab/src/index.ts`
- **Image**: `paradedb/paradedb:latest-pg17`
- **Deployment**: `StatefulSet` (1 replica) with `volumeClaimTemplates`
- **Storage**: `longhorn-uncritical` (10Gi) — ⚠️ no backups for a database
- **Extensions**: `vector` (migration 0005), `pg_search` (migration 0090) — both via `CREATE EXTENSION IF NOT EXISTS`

#### Existing Storage Classes
| StorageClass | Reclaim | Backups | Use for |
|---|---|---|---|
| `longhorn-persistent` | Retain | Daily R2 at 2am, 7-day retention | Databases, critical data |
| `longhorn-uncritical` | Delete | None | Caches, ephemeral |

### Tasks
- [x] Explore existing homelab structure and patterns
- [x] Understand lobehub postgres setup and credential patterns
- [x] Understand Longhorn storage classes
- [x] Evaluate single cluster vs. per-app instances
- [x] Evaluate `PostgresInstance` integration with `ExposedWebApp`
- [x] Research CloudNativePG (CNPG) operator in depth
- [x] Research CNPG credential generation and key mismatch problem
- [x] Research lobehub PG18 compatibility and extension handling
- [x] Confirm ParadeDB PG18 image availability and CNPG compatibility

---

## Plan
<!-- beads-phase-id: homelab-9.2 -->

### Phase Entrance Criteria
- [x] Existing project structure fully understood
- [x] CNPG operator mechanics researched (Cluster CRD, secret format, services, Helm chart)
- [x] Credential key mismatch identified and solution designed (adapter Secret)
- [x] CNPG + ParadeDB PG18 image compatibility confirmed
- [x] Operator installation pattern understood (same as cert-manager/ESO/Longhorn)

### Tasks
- [x] Define full file/directory structure
- [x] Define `PostgresInstance` API (inputs, outputs, defaults)
- [x] Design credential adapter strategy
- [x] Plan `base-infra` changes (CNPG operator)
- [x] Define lobehub migration path

### Implementation Strategy

#### 1. New Files and Changes Overview

```
packages/core/infrastructure/src/
└── cnpg/
    └── index.ts                          ← NEW: CNPG namespace + Helm release

packages/core/infrastructure/src/
└── index.ts                              ← ADD: export * from "./cnpg"

packages/stacks/base-infra/src/
└── index.ts                              ← ADD: cnpg to dependsOn + export

packages/core/components/src/
└── postgres/
    └── PostgresInstance.ts               ← NEW: ComponentResource (CNPG Cluster CRD)

packages/core/components/src/
└── index.ts                              ← ADD: export PostgresInstance + PostgresInstanceArgs

~/projects/open-source/lobehub/deployment/homelab/src/
└── index.ts                              ← FIX: pg17→pg18, longhorn-uncritical→longhorn-persistent
```

#### 2. CNPG Operator (`packages/core/infrastructure/src/cnpg/index.ts`)

Pattern: identical to `cert-manager/index.ts`.

```typescript
// Namespace: cnpg-system, PSS: restricted
// Helm: chart="cloudnative-pg", version="0.28.0", repo="https://cloudnative-pg.io/charts/"
// No CRDs flag needed — CNPG Helm chart installs CRDs by default
// Export: cnpgNamespace, cnpg (Helm Release)
```

Namespace PSS: `restricted` (CNPG controller runs as non-root, drops all caps — meets restricted).

#### 3. `PostgresInstance` Component API

**File**: `packages/core/components/src/postgres/PostgresInstance.ts`

```typescript
export interface PostgresInstanceArgs {
  // Required
  namespace: k8s.core.v1.Namespace;
  databaseName: pulumi.Input<string>;

  // Optional with defaults
  image?: pulumi.Input<string>;        // default: "paradedb/paradedb:latest-pg18"
  username?: pulumi.Input<string>;     // default: "app"  (CNPG convention)
  storageSize?: pulumi.Input<string>;  // default: "5Gi"
  storageClass?: pulumi.Input<string>; // default: "longhorn-persistent"
  instances?: number;                  // default: 1  (set to 3 for HA)
  cnpgOperator?: pulumi.Resource;      // CNPG Helm Release, for dependsOn ordering
}

export class PostgresInstance extends pulumi.ComponentResource {
  readonly serviceName: pulumi.Output<string>;        // "<name>-postgres-rw"
  readonly host: pulumi.Output<string>;               // "<svc>.<ns>.svc.cluster.local"
  readonly port: pulumi.Output<number>;               // 5432
  readonly connectionString: pulumi.Output<string>;   // "postgresql://user:pass@host:5432/db"
  readonly credentialsSecretName: pulumi.Output<string>; // "<name>-postgres-credentials" (adapter)
}
```

**Internal resources created**:

| Resource | Type | Notes |
|---|---|---|
| `<name>-postgres` | `k8s.apiextensions.CustomResource` (CNPG `Cluster`) | `instances: 1`, imageName, storage, bootstrap.initdb |
| `<name>-postgres-credentials` | `k8s.core.v1.Secret` | Adapter: maps CNPG secret keys → `POSTGRES_DB/USER/PASSWORD/DATABASE_URL` |

**No `RandomPassword`** — CNPG generates credentials. No `StatefulSet`, no manual `Service` — CNPG creates `<name>-postgres-rw` service automatically.

**Credential adapter**: after the CNPG `Cluster` is created, CNPG creates `<name>-postgres-app` secret. Pulumi reads that secret's output fields and builds the adapter:

```typescript
const cnpgSecret = k8s.core.v1.Secret.get(
  `${name}-postgres-app`,
  pulumi.interpolate`${namespaceName}/${name}-postgres-app`,
  { dependsOn: [cluster] }
);

// Adapter secret with canonical env var names
new k8s.core.v1.Secret(`${name}-postgres-credentials`, {
  metadata: { name: `${name}-postgres-credentials`, namespace: namespaceName },
  type: "Opaque",
  data: {
    POSTGRES_DB:       cnpgSecret.data.apply(d => d["dbname"]),
    POSTGRES_USER:     cnpgSecret.data.apply(d => d["username"]),
    POSTGRES_PASSWORD: cnpgSecret.data.apply(d => d["password"]),
    DATABASE_URL:      cnpgSecret.data.apply(d => d["uri"]),
  },
}, { dependsOn: [cnpgSecret] });
```

Note: CNPG secret values in `.data` are base64-encoded (standard K8s Secret). Pulumi's `k8s.core.v1.Secret.get` returns them decoded in `.stringData` or still encoded in `.data` — need to verify at implementation time and use `stringData` on the adapter to avoid double-encoding.

**`credentialsSecretName` output** → `<name>-postgres-credentials` (the adapter, not the CNPG one).
**`connectionString` output** → built from CNPG secret's `uri` field.
**`serviceName` output** → `<name>-postgres-rw` (CNPG's read-write service).
**`host` output** → `pulumi.interpolate\`${serviceName}.${namespaceName}.svc.cluster.local\``

#### 4. `base-infra` Changes

**`packages/stacks/base-infra/src/index.ts`**:
- Add `coreInfra.cnpgNamespace` and `coreInfra.cnpg` to `infrastructureReady.dependsOn`
- Export `cnpg: { operator: coreInfra.cnpg }` from `setupBaseInfra()` return value

#### 5. LobeHub Migration (independent correctness fixes)

| Constant | From | To | Why |
|---|---|---|---|
| `PG_IMAGE` | `paradedb/paradedb:latest-pg17` | `paradedb/paradedb:latest-pg18` | PG18 available; lobehub supports "PG17 or higher" |
| `PG_STORAGE_CLASS` | `longhorn-uncritical` | `longhorn-persistent` | Databases must be backed up |

Note: lobehub does NOT adopt the `PostgresInstance` component in this PR. It keeps its inline StatefulSet. These are minimal correctness fixes only.

#### 6. Key Design Decisions & Edge Cases

| Concern | Resolution |
|---|---|
| CNPG webhook ordering | `dependsOn: [cnpgOperator]` on the `Cluster` CRD — same pattern as cert-manager `ClusterIssuer` |
| CNPG secret timing | Adapter secret depends on `Cluster` resource — CNPG creates `<name>-postgres-app` during cluster bootstrap |
| Secret key format | CNPG `.data` is base64 — use `k8s.core.v1.Secret.get` + `.stringData` on adapter to avoid double-encoding |
| `uri` prefix | CNPG uses `postgresql://` not `postgres://` — expose as-is; both are valid; apps using `DATABASE_URL` accept both |
| Multiple instances in one namespace | CNPG clusters have unique names; services are `<cluster>-rw/ro/r` — no collision |
| HA upgrade path | Change `instances: 1 → 3`, run `pulumi up` — operator handles replication setup |
| `storageClass` on `Cluster` | Set via `spec.storage.storageClass` — Longhorn PVC is created by CNPG |
| No `resources` field | CNPG `Cluster` has `spec.resources` — pass through from `PostgresInstanceArgs.resources` if set |

---

## Code
<!-- beads-phase-id: homelab-9.3 -->

### Phase Entrance Criteria
- [x] CNPG operator pattern fully specified
- [x] `PostgresInstance` API and internals fully designed
- [x] Credential adapter strategy finalised
- [x] All edge cases resolved

### Tasks
- [x] Create `packages/core/infrastructure/src/cnpg/index.ts` (namespace + Helm release)
- [x] Export CNPG from `packages/core/infrastructure/src/index.ts`
- [x] Wire CNPG into `packages/stacks/base-infra/src/index.ts`
- [x] Create `packages/core/components/src/postgres/PostgresInstance.ts` (CNPG Cluster CRD + adapter Secret)
- [x] Export `PostgresInstance` from `packages/core/components/src/index.ts`
- [x] Update lobehub: `pg17→pg18`, `longhorn-uncritical→longhorn-persistent`
- [x] Verify TypeScript compiles cleanly across monorepo (`components`, `infrastructure`, `base-infra`, root — all pass)

### Implementation Notes
- CNPG `Cluster` CRD emitted as `k8s.apiextensions.CustomResource` — no `StatefulSet`, no `RandomPassword`
- Adapter Secret decodes CNPG's base64 secret fields (`username`, `password`, `dbname`, `uri`) via `Buffer.from(s, "base64")` in `Output.apply` and re-exposes as `POSTGRES_DB/USER/PASSWORD/DATABASE_URL` via `stringData`
- `cnpgOperator` arg is optional — when provided, added to `Cluster` CRD's `dependsOn` for webhook ordering
- biome lint passes on all new files (0 issues after `--fix` + manual literal-key fix)

---

## Commit
<!-- beads-phase-id: homelab-9.4 -->

### Phase Entrance Criteria
- [x] All Code tasks complete
- [x] TypeScript compiles without errors across all packages
- [x] Lobehub deployment updated
- [x] Code follows existing project patterns

### Tasks
- [x] Stage all changed files (homelab repo + lobehub repo)
- [x] Write conventional commit message
- [x] Commit (WIP — both repos)

### Commit Details
- **homelab** (`feat/postgres-service`): `003ee3c` — "wip: add PostgresInstance component backed by CloudNativePG operator"
  - 8 files changed, 670 insertions: `cnpg/index.ts`, `PostgresInstance.ts`, exports, base-infra wiring, plan, beads
- **lobehub** (`fix/knowledge`): `071e71af8` — "wip: fix postgres image tag and storage class"
  - 1 file: `latest-pg17 → latest-pg18`, `longhorn-uncritical → longhorn-persistent`

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Per-app `PostgresInstance` resources | Full isolation, independent versioning, no shared failure domain |
| Component integration | Independent of `ExposedWebApp` | Orthogonal concerns; composable at call site |
| **Implementation** | **CloudNativePG (CNPG) operator** | WAL archiving, HA upgrade path, credential management, no StatefulSet boilerplate; right choice from day 1 |
| Credential ownership | CNPG-generated (operator creates `<cluster>-app` secret) | No `RandomPassword` needed; CNPG handles lifecycle |
| Credential adapter | Thin adapter Secret re-maps CNPG keys → canonical env var names | Apps expect `POSTGRES_DB/USER/PASSWORD/DATABASE_URL`; CNPG provides `dbname/username/password/uri` |
| `credentialsSecretName` output | Points to adapter Secret, not raw CNPG secret | Callers get stable, conventional env var names |
| Default storage class | `longhorn-persistent` | All databases must be backed up |
| Default image | `paradedb/paradedb:18-v0.23.4` | pgvector + pg_search pre-installed; CNPG-compatible (tag must start with PG major version — `latest-pg18` rejected by webhook) |
| Postgres version | PG18 | CNPG extension image volumes work on PG18+; lobehub compatible; paradedb pg18 available |
| CNPG Helm chart | `cloudnative-pg` v0.28.0 (operator 1.29.0) | Latest stable; same pattern as cert-manager/ESO/Longhorn in this repo |
| `instances` default | 1 | Homelab single-node; upgrade to 3 is one field change |
| **Explicit Helm release name `cnpg`** | `name: "cnpg"` in Helm release | Without it, Pulumi generates a hash-based name that changes on re-create, causing `invalid ownership metadata` on CRDs that were installed by the old release name |
| **`postgresUID/GID` default** | 26 (CNPG/official postgres standard) | paradedb uses 999; the component is image-agnostic — callers override to 999 when using paradedb. Field is **immutable** in CNPG — changing it requires cluster delete+recreate |
| **`sharedPreloadLibraries` default** | `[]` (empty) | Component is image-agnostic; callers declare what their image requires. paradedb needs `["pg_search","pg_cron","pg_stat_statements"]` |
| **`postInitApplicationSQL` default** | `[]` (empty) | Component is image-agnostic; callers pre-install their superuser-required extensions. paradedb/lobehub needs `["CREATE EXTENSION IF NOT EXISTS vector", "CREATE EXTENSION IF NOT EXISTS pg_search"]` |
| **No paradedb defaults in component** | All paradedb-specific config moved to call site | `PostgresInstance` must work with stock postgres image; paradedb users pass their requirements explicitly |
| **Data migration strategy** | `pg_dump` from old StatefulSet pod → `psql` stdin into CNPG pod | Old and new clusters run in parallel; app switched after import verified; old StatefulSet PVC retained until confirmed clean |

---

## Notes

- CNPG deploys into `cnpg-system` namespace with `restricted` PSS (controller is non-root, drops caps)
- CNPG creates 3 Services per cluster: `<name>-rw` (primary), `<name>-ro` (replicas), `<name>-r` (all). Apps should always use `<name>-rw`.
- CNPG secret `<cluster>-app` is created after cluster bootstrap — `Cluster` resource in Pulumi must be fully awaited before reading it
- Lobehub migrations 0005 and 0090 do `CREATE EXTENSION IF NOT EXISTS vector/pg_search` — pre-installing via `postInitApplicationSQL` makes these no-ops
- `paradedb/paradedb:18-v0.23.4` (CNPG-compatible tag format), amd64 + arm64
- Lobehub docs say "PG17 or higher" — PG18 explicitly covered
- **`postgresUID/GID` is immutable in CNPG** — changing it requires deleting the cluster (and its PVCs by default); use `kubectl delete pvc --selector='cnpg.io/cluster=...'` explicitly if needed
- **Pulumi state drift**: after manual cluster deletes, always run `pulumi refresh --yes` before `pulumi up`
- **Old StatefulSet PVC** `data-lobehub-postgres-0` (10Gi, `longhorn-uncritical`) still exists — safe to delete once migration is confirmed permanent: `kubectl delete pvc -n lobehub data-lobehub-postgres-0`
- CNPG app user is `app` (not `postgres`) — adapter secret `lobehub-db-postgres-credentials` exposes `DATABASE_URL` as `postgresql://app:...@lobehub-db-postgres-rw.lobehub:5432/lobehub`
- **Tarball workflow** for local dev: whenever `PostgresInstance.ts` changes → `npm run build && npm pack` in `packages/core/components` → move `.tgz` to temp dir → `rm package-lock.json && npm install` in consumer (integrity hash changes each pack)

## Verification (2026-05-11)

After full migration and refactor:
- `pulumi up` on lobehub: ✅ 4 updated (Cluster spec + Deployment + Service + 4 old resources deleted)
- CNPG Cluster phase: ✅ `Cluster in healthy state`  
- App pod `lobehub-6d59966d79-dkkg5`: ✅ `1/1 Running`, 0 restarts
- DB migration log: ✅ `database migration pass`
- App serving: ✅ `Gateway: Started successfully` on port 3210
- `databaseHost` stack output: ✅ `lobehub-db-postgres-rw.lobehub.svc.cluster.local`
- Old StatefulSet + Secret + Service + RandomPassword: ✅ deleted from Pulumi state
- Data restored: ✅ 1 user, 81 messages, 4 topics, 4 agents

## Data Restore Runbook (pg_dump → CNPG)

When restoring a `pg_dump` from the old StatefulSet (or any postgres superuser) into CNPG:

1. **Scale down the app** to prevent writes during restore:
   ```bash
   kubectl scale deployment -n lobehub lobehub --replicas=0
   ```

2. **Drop and recreate the database** (clean slate):
   ```bash
   kubectl exec -n lobehub lobehub-db-postgres-1 -- psql -U postgres -c \
     "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='lobehub' AND pid <> pg_backend_pid();"
   kubectl exec -n lobehub lobehub-db-postgres-1 -- psql -U postgres -c "DROP DATABASE IF EXISTS lobehub;"
   kubectl exec -n lobehub lobehub-db-postgres-1 -- psql -U postgres -c "CREATE DATABASE lobehub OWNER app;"
   ```

3. **Restore the dump**:
   ```bash
   cat /path/to/dump.sql | kubectl exec -i -n lobehub lobehub-db-postgres-1 -- psql -U postgres -d lobehub
   ```

4. **Fix all object ownership** — `pg_dump` preserves the original owner (`postgres`); CNPG's `app` user needs ownership of everything it must read/write:
   ```bash
   kubectl exec -n lobehub lobehub-db-postgres-1 -- psql -U postgres -d lobehub -c "
   -- Tables
   DO \$\$ DECLARE r RECORD; BEGIN
     FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
       EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO app';
     END LOOP;
   END\$\$;
   -- Sequences
   DO \$\$ DECLARE r RECORD; BEGIN
     FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
       EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO app';
     END LOOP;
   END\$\$;
   -- Schema-level grants
   GRANT ALL ON SCHEMA public TO app;
   GRANT ALL ON ALL TABLES IN SCHEMA public TO app;
   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app;
   GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO app;
   ALTER SCHEMA drizzle OWNER TO app;
   GRANT ALL ON SCHEMA drizzle TO app;
   GRANT ALL ON ALL TABLES IN SCHEMA drizzle TO app;
   "
   ```

5. **Scale the app back up**:
   ```bash
   kubectl scale deployment -n lobehub lobehub --replicas=1
   ```

**Root cause of permission errors after restore**: `pg_dump` preserves the original object owner (`postgres` from the old StatefulSet). CNPG's `app` user is not a superuser and cannot read/write tables it doesn't own or have explicit grants on. Affects: schemas (`drizzle`, `public`), all tables, all sequences. Fix: transfer ownership of everything to `app` after restore (see step 4 above).

---
*This plan is maintained by the LLM. Tool responses provide guidance on phase transitions.*
