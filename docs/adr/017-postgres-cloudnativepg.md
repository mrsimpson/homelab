# ADR-017: Per-app PostgreSQL via CloudNativePG

**Status:** Accepted

## Context

Apps in this homelab need persistent PostgreSQL. Two structural questions arose:

1. **Shared cluster vs. per-app instances** — one central Postgres cluster serving all apps, or one instance per app?
2. **Operator vs. StatefulSet** — manage Postgres via a Kubernetes operator or hand-roll StatefulSets?

## Decisions

### Per-app instances

Each app gets its own CNPG `Cluster`. A shared cluster would couple app lifecycles, complicate credential management, and create a single failure domain. Per-app instances provide full isolation, independent storage sizing, and a contained blast radius.

### CloudNativePG (CNPG) operator

CNPG manages the `Cluster` CRD into pods, PVCs, services, and auto-generated credentials — eliminating StatefulSet boilerplate. Key reasons over a hand-rolled StatefulSet:

- Automated credential generation and rotation (`<cluster>-app` secret)
- WAL archiving and backup integration
- HA via `instances: N` — one field change, no data migration

CNPG follows the same operator pattern already established in this repo (cert-manager, ESO, Longhorn): namespace + Helm release in `core/infrastructure`, exported and wired into `base-infra`.

## Consequences

- All databases use `longhorn-persistent` (daily R2 backup, 7-day retention).
- CNPG generates credentials under its own key names; a thin adapter `Secret` re-maps them to `POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / DATABASE_URL`.
- `postgresUID/GID` is immutable after cluster creation — changing it requires cluster deletion and restore from backup.
- `postInitApplicationSQL` runs once at bootstrap as superuser — the only way to pre-install superuser-only extensions so the app user never needs elevated privileges.

See [deploy-database.md](../howto/deploy-database.md) for usage and the restore runbook.
