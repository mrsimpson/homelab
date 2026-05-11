# ADR-017: PostgreSQL via CloudNativePG

**Status:** Accepted

## Context

Apps need persistent PostgreSQL. The previous approach (custom `StatefulSet` per app) required
manually managing credentials, storage, and image upgrades with no HA path.

## Decision

Use the [CloudNativePG (CNPG)](https://cloudnative-pg.io/) operator to manage all PostgreSQL
instances. Wrap it in a `PostgresInstance` Pulumi `ComponentResource`.

## Architecture

```
base-infra stack
└── cnpg (Helm release, cnpg-system namespace)
    └── ValidatingWebhookConfiguration  ← validates Cluster CRDs

app stack
└── PostgresInstance ComponentResource
    ├── Cluster CRD  ← CNPG reconciles → pod, PVC, services, secrets
    │   └── <name>-postgres-app  (CNPG-generated: username/password/uri/...)
    └── adapter Secret (<name>-postgres-credentials)
        └── POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / DATABASE_URL
```

## Key decisions

**Per-app instances** — isolation, independent storage sizing, independent upgrade path.

**Adapter secret** — CNPG generates credentials under its own key names (`uri`, `dbname`, etc.).
Apps expect `DATABASE_URL`, `POSTGRES_*`. A thin Pulumi-managed secret re-maps them.

**Image-agnostic component** — `PostgresInstance` has no paradedb-specific defaults. Callers
declare `postgresUID/GID`, `sharedPreloadLibraries`, and `postInitApplicationSQL` explicitly.
This keeps the component usable with the official postgres image without any paradedb leakage.

**`postgresUID/GID` immutable** — CNPG sets ownership on the PVC at bootstrap. Changing it
requires deleting the cluster (and its PVC) and re-creating from backup.

**`postInitApplicationSQL` for superuser extensions** — CNPG's app user is intentionally not
a superuser. Extensions requiring superuser (`vector`, `pg_search`) are pre-installed at
bootstrap via this field, so app migrations using `CREATE EXTENSION IF NOT EXISTS` are no-ops.

**Explicit Helm release name `"cnpg"`** — prevents hash-based name changes that break the
Helm ownership annotations CNPG embeds in its CRDs.

## Storage

All databases use `longhorn-persistent` (daily R2 backup, 7-day retention) rather than
`longhorn-uncritical` (no backups).

## HA path

`instances: 1 → 3` triggers CNPG to provision hot-standby replicas and configure automatic
failover. No API or credential changes required in the app stack.

## Restore

See [deploy-database.md](../howto/deploy-database.md#restore-runbook-pgdump--cnpg).
Key gotcha: `pg_dump` preserves the original object owner. After restoring into a CNPG cluster,
all tables and sequences must be `ALTER ... OWNER TO app`.
