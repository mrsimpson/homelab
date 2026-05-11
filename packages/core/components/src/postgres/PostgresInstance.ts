import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * PostgresInstance — per-app PostgreSQL backed by the CloudNativePG (CNPG) operator.
 *
 * Creates a CNPG `Cluster` CRD and an adapter `Secret` that exposes the generated
 * credentials under canonical env var names (`POSTGRES_DB`, `POSTGRES_USER`,
 * `POSTGRES_PASSWORD`, `DATABASE_URL`).
 *
 * See docs/howto/deploy-database.md for usage and the restore runbook.
 */

// CNPG webhook rejects tags that don't start with the PG major version (e.g. "latest-pg18").
const DEFAULT_IMAGE = "paradedb/paradedb:18-v0.23.4";
const DEFAULT_USERNAME = "app"; // CNPG convention: app user owns the app database
const DEFAULT_STORAGE_SIZE = "5Gi";
const DEFAULT_STORAGE_CLASS = "longhorn-persistent";
const DEFAULT_INSTANCES = 1;
const PG_PORT = 5432;
// Official postgres image (Debian) uses UID/GID 26 — matches CNPG's own default.
// Override at call site for non-standard images (paradedb uses 999).
const DEFAULT_POSTGRES_UID = 26;
const DEFAULT_POSTGRES_GID = 26;
export interface PostgresInstanceArgs {
  /** Pre-created Kubernetes namespace to deploy into */
  namespace: k8s.core.v1.Namespace;

  /** Name of the database to create */
  databaseName: pulumi.Input<string>;

  /**
   * Container image for Postgres.
   * Must start with the PG major version (e.g. `18-v0.23.4`) — CNPG's webhook rejects `latest-pg18`.
   * @default "paradedb/paradedb:18-v0.23.4"
   */
  image?: pulumi.Input<string>;

  /** @default "app" — CNPG convention */
  username?: pulumi.Input<string>;

  /** @default "5Gi" */
  storageSize?: pulumi.Input<string>;

  /**
   * @default "longhorn-persistent" — daily R2 backup, 7-day retention
   */
  storageClass?: pulumi.Input<string>;

  /**
   * Primary + hot-standby count. Set to 3 for HA — CNPG handles promotion automatically.
   * @default 1
   */
  instances?: number;

  /**
   * UID/GID for the postgres OS user. Official postgres image uses 26; paradedb uses 999.
   * **Immutable** — changing requires cluster deletion and recreation.
   * @default 26
   */
  postgresUID?: number;
  postgresGID?: number;

  /**
   * Libraries for `shared_preload_libraries`. Required for extensions that cannot load
   * on demand (e.g. `pg_search`, `pg_cron`).
   * @default []
   */
  sharedPreloadLibraries?: string[];

  /**
   * SQL run as superuser in the app database at bootstrap — before the app user connects.
   * Use to pre-install superuser-only extensions so app migrations are no-ops.
   * Only runs once at cluster creation; not re-applied on updates.
   * @default []
   */
  postInitApplicationSQL?: string[];

  /**
   * CNPG operator Helm Release. Pass `baseInfra.cnpg.operator` to ensure the webhook
   * is ready before the `Cluster` CRD is applied.
   */
  cnpgOperator?: pulumi.Resource;
}

export class PostgresInstance extends pulumi.ComponentResource {
  /** Read-write (primary) service name: `<name>-postgres-rw` */
  readonly serviceName: pulumi.Output<string>;

  /** In-cluster hostname: `<service>.<namespace>.svc.cluster.local` */
  readonly host: pulumi.Output<string>;

  readonly port: pulumi.Output<number>;

  /** Full connection string — treat as secret. */
  readonly connectionString: pulumi.Output<string>;

  /**
   * Adapter Secret name containing `POSTGRES_DB`, `POSTGRES_USER`,
   * `POSTGRES_PASSWORD`, `DATABASE_URL`.
   *
   * ```typescript
   * envFrom: [{ secretRef: { name: db.credentialsSecretName } }]
   * ```
   */
  readonly credentialsSecretName: pulumi.Output<string>;

  constructor(name: string, args: PostgresInstanceArgs, opts?: pulumi.ComponentResourceOptions) {
    super("homelab:components:PostgresInstance", name, args, opts);

    const childOpts: pulumi.ComponentResourceOptions = { parent: this };

    const namespaceName = args.namespace.metadata.name as pulumi.Output<string>;

    const image = args.image ?? DEFAULT_IMAGE;
    const username = args.username ?? DEFAULT_USERNAME;
    const storageSize = args.storageSize ?? DEFAULT_STORAGE_SIZE;
    const storageClass = args.storageClass ?? DEFAULT_STORAGE_CLASS;
    const instances = args.instances ?? DEFAULT_INSTANCES;
    const postgresUID = args.postgresUID ?? DEFAULT_POSTGRES_UID;
    const postgresGID = args.postgresGID ?? DEFAULT_POSTGRES_GID;
    const sharedPreloadLibraries = args.sharedPreloadLibraries ?? [];
    const postInitApplicationSQL = args.postInitApplicationSQL ?? [];

    // CNPG names its objects as "<cluster-name>-<suffix>"
    const clusterName = `${name}-postgres`;
    const cnpgSecretName = `${clusterName}-app`;
    const adapterSecretName = `${name}-postgres-credentials`;
    const serviceName = `${clusterName}-rw`;

    const clusterDependsOn: pulumi.Resource[] = [args.namespace];
    if (args.cnpgOperator) clusterDependsOn.push(args.cnpgOperator);

    const cluster = new k8s.apiextensions.CustomResource(
      clusterName,
      {
        apiVersion: "postgresql.cnpg.io/v1",
        kind: "Cluster",
        metadata: {
          name: clusterName,
          namespace: namespaceName,
          labels: {
            app: name,
            "app.kubernetes.io/managed-by": "pulumi",
          },
        },
        spec: {
          instances,
          imageName: image,
          postgresUID,
          postgresGID,
          bootstrap: {
            initdb: {
              database: args.databaseName,
              owner: username,
              postInitApplicationSQL,
            },
          },
          postgresql: {
            shared_preload_libraries: sharedPreloadLibraries,
          },
          storage: {
            size: storageSize,
            storageClass,
          },
        },
      },
      { ...childOpts, dependsOn: clusterDependsOn }
    );

    // CNPG auto-creates `<cluster>-app` after bootstrap. We read it to project its
    // base64-encoded fields into our canonical adapter secret.
    const cnpgSecret = k8s.core.v1.Secret.get(
      cnpgSecretName,
      pulumi.interpolate`${namespaceName}/${cnpgSecretName}`,
      { ...childOpts, dependsOn: [cluster] }
    );

    const cnpgData = cnpgSecret.data;
    const b64decode = (v: pulumi.Output<string>): pulumi.Output<string> =>
      v.apply((s) => Buffer.from(s, "base64").toString("utf-8"));

    const decodedUsername = b64decode(cnpgData.apply((d) => d.username ?? ""));
    const decodedPassword = b64decode(cnpgData.apply((d) => d.password ?? ""));
    const decodedDbname = b64decode(cnpgData.apply((d) => d.dbname ?? ""));
    const decodedUri = b64decode(cnpgData.apply((d) => d.uri ?? ""));

    new k8s.core.v1.Secret(
      adapterSecretName,
      {
        metadata: {
          name: adapterSecretName,
          namespace: namespaceName,
          labels: {
            app: name,
            "app.kubernetes.io/managed-by": "pulumi",
          },
          annotations: {
            "homelab/cnpg-source-secret": cnpgSecretName,
          },
        },
        type: "Opaque",
        stringData: {
          POSTGRES_DB: decodedDbname,
          POSTGRES_USER: decodedUsername,
          POSTGRES_PASSWORD: decodedPassword,
          DATABASE_URL: decodedUri,
        },
      },
      { ...childOpts, dependsOn: [cnpgSecret] }
    );

    const host = pulumi.interpolate`${serviceName}.${namespaceName}.svc.cluster.local`;

    this.serviceName = pulumi.output(serviceName);
    this.host = host;
    this.port = pulumi.output(PG_PORT);
    this.connectionString = decodedUri;
    this.credentialsSecretName = pulumi.output(adapterSecretName);

    this.registerOutputs({
      serviceName: this.serviceName,
      host: this.host,
      port: this.port,
      connectionString: this.connectionString,
      credentialsSecretName: this.credentialsSecretName,
    });
  }
}
