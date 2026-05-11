# How to Deploy a Database

PostgreSQL instances are managed by the [CloudNativePG (CNPG)](https://cloudnative-pg.io/) operator
via the `PostgresInstance` component from `@mrsimpson/homelab-core-components`.

See [ADR-017](../adr/017-postgres-cloudnativepg.md) for why CNPG was chosen over a StatefulSet.

## Prerequisites

- Base infrastructure deployed (`cnpg` operator running in `cnpg-system`)
- A pre-created namespace for your app

## Usage

```typescript
import { PostgresInstance } from "@mrsimpson/homelab-core-components";

const db = new PostgresInstance("myapp-db", {
  namespace: ns,
  databaseName: "myapp",
  storageSize: "10Gi",
  cnpgOperator: baseInfra.cnpg.operator, // ensures webhook is ready
});

// Wire credentials into the app
const app = homelab.createExposedWebApp("myapp", {
  // ...
  envFrom: [{ secretRef: { name: db.credentialsSecretName } }],
});
```

The adapter secret (`<name>-postgres-credentials`) exposes:
`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`

## Options

| Arg | Default | Notes |
|---|---|---|
| `image` | `paradedb/paradedb:18-v0.23.4` | Tag must start with PG major version |
| `storageSize` | `5Gi` | |
| `storageClass` | `longhorn-persistent` | Daily R2 backup, 7-day retention |
| `instances` | `1` | Set to `3` for HA — no API changes needed |
| `postgresUID/GID` | `26` | paradedb needs `999`; **immutable** after cluster creation |
| `sharedPreloadLibraries` | `[]` | Required for `pg_search`, `pg_cron`, etc. |
| `postInitApplicationSQL` | `[]` | Pre-install superuser-only extensions at bootstrap |

## Non-standard images (e.g. paradedb)

Extensions like `pg_search` require superuser to install and need preloading. Declare both at the call site:

```typescript
const db = new PostgresInstance("myapp-db", {
  namespace: ns,
  databaseName: "myapp",
  image: "paradedb/paradedb:18-v0.23.4",
  postgresUID: 999,
  postgresGID: 999,
  sharedPreloadLibraries: ["pg_search", "pg_cron", "pg_stat_statements"],
  postInitApplicationSQL: [
    "CREATE EXTENSION IF NOT EXISTS vector",
    "CREATE EXTENSION IF NOT EXISTS pg_search",
  ],
  cnpgOperator: baseInfra.cnpg.operator,
});
```

## HA upgrade

Change `instances: 1` → `instances: 3` and run `pulumi up`. No other changes required.

## Restore runbook (pg_dump → CNPG)

When restoring from a dump taken outside CNPG (e.g. old StatefulSet), all objects are owned
by `postgres`. CNPG's `app` user needs ownership transferred before the application can write.

```bash
# 1. Scale down app
kubectl scale deployment -n myapp myapp --replicas=0

# 2. Clean slate
kubectl exec -n myapp myapp-db-postgres-1 -- psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='myapp' AND pid <> pg_backend_pid();"
kubectl exec -n myapp myapp-db-postgres-1 -- psql -U postgres -c "DROP DATABASE IF EXISTS myapp;"
kubectl exec -n myapp myapp-db-postgres-1 -- psql -U postgres -c "CREATE DATABASE myapp OWNER app;"

# 3. Restore
cat dump.sql | kubectl exec -i -n myapp myapp-db-postgres-1 -- psql -U postgres -d myapp

# 4. Transfer ownership (pg_dump preserves original owner)
kubectl exec -n myapp myapp-db-postgres-1 -- psql -U postgres -d myapp -c "
DO \$\$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO app';
  END LOOP;
END\$\$;
DO \$\$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO app';
  END LOOP;
END\$\$;
GRANT ALL ON SCHEMA public TO app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO app;
"
# If your app uses a drizzle schema:
kubectl exec -n myapp myapp-db-postgres-1 -- psql -U postgres -d myapp -c "
ALTER SCHEMA drizzle OWNER TO app;
GRANT ALL ON SCHEMA drizzle TO app;
GRANT ALL ON ALL TABLES IN SCHEMA drizzle TO app;
"

# 5. Scale app back up
kubectl scale deployment -n myapp myapp --replicas=1
```
