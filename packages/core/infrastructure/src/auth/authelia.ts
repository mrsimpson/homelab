import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Authelia - Centralized authentication and authorization server
 *
 * Provides:
 * - Forward authentication for ingress-nginx
 * - OIDC provider for applications (e.g., Supabase)
 * - Social login federation (GitHub, Google)
 * - Multi-factor authentication (TOTP, WebAuthn)
 * - Per-app access policies
 *
 * See ADR 011 for architecture decisions.
 */

const config = new pulumi.Config();

export interface AutheliaConfig {
  /** Domain for Authelia auth portal (e.g., "auth.example.com") */
  domain: string | pulumi.Output<string>;

  /** Secret for session encryption (32+ random bytes, base64 encoded) */
  sessionSecret?: pulumi.Output<string>;

  /** Secret for storage encryption (64+ random bytes, base64 encoded) */
  storageEncryptionKey?: pulumi.Output<string>;

  /** SMTP configuration for email notifications (optional) */
  smtp?: {
    host: string;
    port: number;
    username: string;
    password: pulumi.Output<string>;
    sender: string;
  };

  /** Storage backend configuration */
  storage?: {
    /** Storage class for PostgreSQL PVC */
    storageClass?: string;
    /** Size of PostgreSQL PVC (defaults to 1Gi, suitable for <20 users) */
    size?: string;
  };

  /** Cloudflare configuration for DNS record (optional) */
  cloudflare?: {
    /** Cloudflare Zone ID */
    zoneId: string;
    /** CNAME value (usually the Cloudflare Tunnel hostname) */
    tunnelCname: string | pulumi.Output<string>;
  };

  /** Dependencies */
  dependencies?: {
    ingressController?: pulumi.Resource;
    externalSecretsOperator?: pulumi.Resource;
  };
}

// Create namespace for Authelia
const namespace = new k8s.core.v1.Namespace("authelia", {
  metadata: {
    name: "authelia",
    labels: {
      name: "authelia",
      "pod-security.kubernetes.io/enforce": "restricted",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    },
  },
});

/**
 * Deploy Authelia authentication server
 */
export function createAuthelia(args: AutheliaConfig) {
  const dependencies: pulumi.Resource[] = [namespace];
  if (args.dependencies?.ingressController) {
    dependencies.push(args.dependencies.ingressController);
  }
  if (args.dependencies?.externalSecretsOperator) {
    dependencies.push(args.dependencies.externalSecretsOperator);
  }

  // PostgreSQL for session storage (lightweight single instance)
  const postgresPassword = config.requireSecret("autheliaPostgresPassword");

  const postgresSecret = new k8s.core.v1.Secret(
    "authelia-postgres",
    {
      metadata: {
        name: "authelia-postgres",
        namespace: namespace.metadata.name,
      },
      stringData: {
        password: postgresPassword,
      },
    },
    { dependsOn: [namespace] }
  );

  // PostgreSQL PVC (1Gi is sufficient for <20 users)
  const postgresPvc = new k8s.core.v1.PersistentVolumeClaim(
    "authelia-postgres-pvc",
    {
      metadata: {
        name: "authelia-postgres",
        namespace: namespace.metadata.name,
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: args.storage?.storageClass || "longhorn-persistent",
        resources: {
          requests: {
            storage: args.storage?.size || "1Gi",
          },
        },
      },
    },
    { dependsOn: [namespace] }
  );

  // PostgreSQL Deployment
  const postgresDeployment = new k8s.apps.v1.Deployment(
    "authelia-postgres",
    {
      metadata: {
        name: "authelia-postgres",
        namespace: namespace.metadata.name,
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: { app: "authelia-postgres" },
        },
        template: {
          metadata: {
            labels: { app: "authelia-postgres" },
          },
          spec: {
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 999, // postgres user
              fsGroup: 999,
            },
            containers: [
              {
                name: "postgres",
                image: "postgres:16-alpine",
                ports: [{ containerPort: 5432 }],
                env: [
                  { name: "POSTGRES_DB", value: "authelia" },
                  { name: "POSTGRES_USER", value: "authelia" },
                  {
                    name: "POSTGRES_PASSWORD",
                    valueFrom: {
                      secretKeyRef: {
                        name: postgresSecret.metadata.name,
                        key: "password",
                      },
                    },
                  },
                  { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
                ],
                volumeMounts: [
                  {
                    name: "data",
                    mountPath: "/var/lib/postgresql/data",
                  },
                ],
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "512Mi" },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ["ALL"] },
                  seccompProfile: { type: "RuntimeDefault" },
                },
              },
            ],
            volumes: [
              {
                name: "data",
                persistentVolumeClaim: {
                  claimName: postgresPvc.metadata.name,
                },
              },
            ],
          },
        },
      },
    },
    { dependsOn: [postgresSecret, postgresPvc] }
  );

  // PostgreSQL Service
  const postgresService = new k8s.core.v1.Service(
    "authelia-postgres",
    {
      metadata: {
        name: "authelia-postgres",
        namespace: namespace.metadata.name,
      },
      spec: {
        type: "ClusterIP",
        selector: { app: "authelia-postgres" },
        ports: [
          {
            port: 5432,
            targetPort: 5432,
          },
        ],
      },
    },
    { dependsOn: [postgresDeployment] }
  );

  // Authelia secrets
  const sessionSecret = args.sessionSecret || config.requireSecret("autheliaSessionSecret");
  const storageEncryptionKey =
    args.storageEncryptionKey || config.requireSecret("autheliaStorageEncryptionKey");
  const jwtSecret = config.requireSecret("autheliaJwtSecret");

  const autheliaSecrets = new k8s.core.v1.Secret(
    "authelia-secrets",
    {
      metadata: {
        name: "authelia-secrets",
        namespace: namespace.metadata.name,
      },
      stringData: {
        sessionSecret: sessionSecret,
        storageEncryptionKey: storageEncryptionKey,
        jwtSecret: jwtSecret,
      },
    },
    { dependsOn: [namespace] }
  );

  // Authelia configuration
  // Note: Uses environment variables for secrets that are injected via deployment env vars
  const autheliaConfig = new k8s.core.v1.ConfigMap(
    "authelia-config",
    {
      metadata: {
        name: "authelia-config",
        namespace: namespace.metadata.name,
      },
      data: {
        "configuration.yml": pulumi
          .all([args.domain, postgresService.metadata.name, postgresPassword])
          .apply(
            ([domain, pgServiceName, dbPassword]) => `---
theme: auto
default_2fa_method: totp

server:
  address: 'tcp://0.0.0.0:9091'

log:
  level: info
  format: text

totp:
  issuer: ${domain}
  period: 30
  skew: 1

authentication_backend:
  refresh_interval: 5m
  password_reset:
    disable: false
  file:
    path: /config/users_database.yml
    password:
      algorithm: argon2
      argon2:
        variant: argon2id
        iterations: 3
        memory: 65536
        parallelism: 4
        key_length: 32
        salt_length: 16

access_control:
  default_policy: one_factor
  rules: []
  # Rules will be added via ConfigMap updates for each protected app

session:
  cookies:
    - domain: ${domain.replace(/^auth\./, "")}
      name: authelia_session
      authelia_url: https://${domain}
      same_site: lax
      expiration: 1h
      inactivity: 5m
      remember_me: 1M

regulation:
  max_retries: 5
  find_time: 2m
  ban_time: 5m

storage:
  encryption_key: \${STORAGE_ENCRYPTION_KEY}
  postgres:
    address: 'tcp://${pgServiceName}:5432'
    database: authelia
    username: authelia
    password: ${dbPassword}

notifier:
  disable_startup_check: true
  filesystem:
    filename: /config/notifications.txt

identity_validation:
  reset_password:
    jwt_secret: \${JWT_SECRET}`
          ),
      },
    },
    { dependsOn: [namespace, postgresService] }
  );

  // Initial users database (empty, for manual user addition later)
  const usersDatabase = new k8s.core.v1.ConfigMap(
    "authelia-users",
    {
      metadata: {
        name: "authelia-users",
        namespace: namespace.metadata.name,
      },
      data: {
        "users_database.yml": `---
users:
  admin:
    disabled: false
    displayname: "Admin User"
    password: "$argon2id$v=19$m=65536,t=3,p=4$oeiJ+TD2tP81UkG2gFA09w$SAkup7Gi7bjGXBrEZ6VNNxBcMaJ8W4nrro6qCoA1nwk"
    email: admin@example.com
    groups:
      - admins
# Additional users can be added via ConfigMap updates or automation
`,
      },
    },
    { dependsOn: [namespace] }
  );

  // Authelia Deployment
  const autheliaDeployment = new k8s.apps.v1.Deployment(
    "authelia",
    {
      metadata: {
        name: "authelia",
        namespace: namespace.metadata.name,
        labels: {
          app: "authelia",
        },
      },
      spec: {
        replicas: 2, // HA setup
        selector: {
          matchLabels: { app: "authelia" },
        },
        template: {
          metadata: {
            labels: { app: "authelia" },
          },
          spec: {
            // Disable automatic service link environment variables to prevent Authelia config parsing errors
            // Kubernetes injects AUTHELIA_SERVICE_* env vars which conflict with Authelia's deprecation mapping
            enableServiceLinks: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              fsGroup: 1000,
            },
            containers: [
              {
                name: "authelia",
                image: "authelia/authelia:4.38",
                ports: [{ containerPort: 9091, name: "http" }],
                env: [
                  {
                    name: "AUTHELIA_SESSION_SECRET",
                    valueFrom: {
                      secretKeyRef: {
                        name: autheliaSecrets.metadata.name,
                        key: "sessionSecret",
                      },
                    },
                  },
                  {
                    name: "STORAGE_ENCRYPTION_KEY",
                    valueFrom: {
                      secretKeyRef: {
                        name: autheliaSecrets.metadata.name,
                        key: "storageEncryptionKey",
                      },
                    },
                  },
                  {
                    name: "POSTGRES_PASSWORD",
                    valueFrom: {
                      secretKeyRef: {
                        name: postgresSecret.metadata.name,
                        key: "password",
                      },
                    },
                  },
                  {
                    name: "JWT_SECRET",
                    valueFrom: {
                      secretKeyRef: {
                        name: autheliaSecrets.metadata.name,
                        key: "jwtSecret",
                      },
                    },
                  },
                ],
                volumeMounts: [
                  {
                    name: "config",
                    mountPath: "/config/configuration.yml",
                    subPath: "configuration.yml",
                  },
                  {
                    name: "users",
                    mountPath: "/config/users_database.yml",
                    subPath: "users_database.yml",
                  },
                ],
                resources: {
                  requests: { cpu: "50m", memory: "128Mi" },
                  limits: { cpu: "200m", memory: "256Mi" },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ["ALL"] },
                  seccompProfile: { type: "RuntimeDefault" },
                },
                livenessProbe: {
                  httpGet: {
                    path: "/api/health",
                    port: 9091,
                    scheme: "HTTP",
                  },
                  initialDelaySeconds: 30,
                  periodSeconds: 30,
                  timeoutSeconds: 5,
                  failureThreshold: 3,
                },
                readinessProbe: {
                  httpGet: {
                    path: "/api/health",
                    port: 9091,
                    scheme: "HTTP",
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                  failureThreshold: 3,
                },
              },
            ],
            volumes: [
              {
                name: "config",
                configMap: {
                  name: autheliaConfig.metadata.name,
                },
              },
              {
                name: "users",
                configMap: {
                  name: usersDatabase.metadata.name,
                },
              },
            ],
          },
        },
      },
    },
    { dependsOn: [autheliaConfig, autheliaSecrets, usersDatabase, postgresDeployment] }
  );

  // Authelia Service
  const autheliaService = new k8s.core.v1.Service(
    "authelia",
    {
      metadata: {
        name: "authelia",
        namespace: namespace.metadata.name,
      },
      spec: {
        type: "ClusterIP",
        selector: { app: "authelia" },
        ports: [
          {
            port: 80,
            targetPort: 9091,
            protocol: "TCP",
            name: "http",
          },
        ],
      },
    },
    { dependsOn: [autheliaDeployment] }
  );

  // Create Cloudflare DNS record for Authelia portal if Cloudflare config is provided
  let authelia_DnsRecord: cloudflare.Record | undefined;
  if (args.cloudflare) {
    // Extract subdomain from domain (e.g., "auth.example.com" -> "auth")
    const subdomain = pulumi.output(args.domain).apply((domain) => domain.split(".")[0]);

    authelia_DnsRecord = new cloudflare.Record("authelia-dns", {
      zoneId: args.cloudflare.zoneId,
      name: subdomain as any, // Type assertion needed for pulumi.Output<string>
      type: "CNAME",
      content: args.cloudflare.tunnelCname,
      comment: "Managed by Pulumi - Authelia authentication portal",
      proxied: true,
    });
  }

  // Return resources for use by other components
  return {
    namespace,
    deployment: autheliaDeployment,
    service: autheliaService,
    configMap: autheliaConfig,
    usersConfigMap: usersDatabase,
    postgresService,
    dnsRecord: authelia_DnsRecord,

    // Auth URLs for ingress annotations
    // Use FQDN for proper service discovery (works with ClusterFirstWithHostNet DNS policy on ingress)
    verifyUrl: pulumi.interpolate`http://${autheliaService.metadata.name}.${namespace.metadata.name}.svc.cluster.local/api/verify`,
    signinUrl: pulumi.interpolate`https://${args.domain}`,
  };
}

export const autheliaNamespace = namespace.metadata.name;
