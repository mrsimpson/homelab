import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * Authelia - Centralized Authentication Service
 *
 * Provides:
 * - Forward authentication for nginx ingress (auth-url, auth-signin)
 * - OpenID Connect provider for external applications (Supabase)
 * - GitHub/Google OAuth federation
 * - SQLite backend for homelab-appropriate simplicity
 *
 * This module creates a singleton authentication service that serves the entire homelab.
 * Applications use forward auth by setting auth: AuthType.FORWARD in ExposedWebApp.
 */

// Create namespace for Authelia
export const autheliaNamespace = new k8s.core.v1.Namespace("authelia-ns", {
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

// Get Pulumi configuration for Authelia
const autheliaConfig = new pulumi.Config("authelia");
const homelabConfig = new pulumi.Config("homelab");

// Create secret for Authelia environment variables
const autheliaSecrets = new k8s.core.v1.Secret(
  "authelia-secrets",
  {
    metadata: {
      name: "authelia-secrets",
      namespace: autheliaNamespace.metadata.name,
    },
    stringData: {
      jwtSecret: autheliaConfig.requireSecret("jwtSecret"),
      sessionSecret: autheliaConfig.requireSecret("sessionSecret"),
      encryptionKey: autheliaConfig.requireSecret("encryptionKey"),
    },
  },
  {
    dependsOn: [autheliaNamespace],
  }
);

// Create Authelia configuration with proper v4.38.0 format
const autheliaConfigYaml = pulumi
  .all([
    homelabConfig.require("domain"), // Use existing homelab domain
  ])
  .apply(([homelabDomain]) => {
    const authDomain = `auth.${homelabDomain}`;
    const sessionDomain = homelabDomain;

    return `---
theme: auto
default_2fa_method: totp

server:
  address: 'tcp://0.0.0.0:9091'

log:
  level: info
  format: text

totp:
  issuer: ${authDomain}
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

session:
  cookies:
    - domain: ${sessionDomain}
      name: authelia_session
      authelia_url: https://${authDomain}
      default_redirection_url: https://${sessionDomain}
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
  local:
    path: /data/db.sqlite3

notifier:
  disable_startup_check: true
  filesystem:
    filename: /config/notifications.txt

identity_validation:
  reset_password:
    jwt_secret: \${JWT_SECRET}
`;
  });

// Create basic users database (will be replaced with OAuth later)
const usersDatabase = pulumi.all([homelabConfig.require("domain")]).apply(
  ([domain]) => `users:
  admin:
    displayname: "Administrator"
    password: "$argon2id$v=19$m=65536,t=3,p=4$Y1BGN1dMT3BLUko4b1ZjVA$9PrT/LgJT8H8wZFBzqyZJGgWXKPQGOXCqGgKNm0uqN8"  # changeme
    email: admin@${domain}
    groups:
      - admins
      - dev
`
);

// Create ConfigMap for Authelia configuration
export const autheliaConfigMap = new k8s.core.v1.ConfigMap(
  "authelia-config",
  {
    metadata: {
      name: "authelia-config",
      namespace: autheliaNamespace.metadata.name,
    },
    data: {
      "configuration.yml": autheliaConfigYaml,
      "users_database.yml": usersDatabase,
    },
  },
  {
    dependsOn: [autheliaNamespace],
  }
);

// Create PVC for SQLite database and session storage
export const autheliaPvc = new k8s.core.v1.PersistentVolumeClaim(
  "authelia-storage",
  {
    metadata: {
      name: "authelia-storage",
      namespace: autheliaNamespace.metadata.name,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn-persistent", // Automatic R2 backups
      resources: {
        requests: {
          storage: "1Gi", // SQLite database + session storage
        },
      },
    },
  },
  {
    dependsOn: [autheliaNamespace],
  }
);

// Create Deployment for Authelia
export const autheliaDeployment = new k8s.apps.v1.Deployment(
  "authelia",
  {
    metadata: {
      name: "authelia",
      namespace: autheliaNamespace.metadata.name,
      labels: {
        app: "authelia",
        environment: "homelab",
      },
    },
    spec: {
      replicas: 1, // Single replica for homelab
      selector: {
        matchLabels: {
          app: "authelia",
        },
      },
      template: {
        metadata: {
          labels: {
            app: "authelia",
          },
        },
        spec: {
          // Disable automatic service link environment variables to prevent Authelia config parsing errors
          // Kubernetes injects AUTHELIA_SERVICE_* env vars which conflict with Authelia's deprecation mapping
          enableServiceLinks: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
          },
          containers: [
            {
              name: "authelia",
              image: "authelia/authelia:4.38.0",
              ports: [
                {
                  containerPort: 9091,
                  name: "http",
                },
              ],
              env: [
                {
                  name: "JWT_SECRET",
                  valueFrom: {
                    secretKeyRef: {
                      name: "authelia-secrets", // We'll create this secret
                      key: "jwtSecret",
                    },
                  },
                },
                {
                  name: "STORAGE_ENCRYPTION_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: "authelia-secrets",
                      key: "encryptionKey",
                    },
                  },
                },
              ],
              volumeMounts: [
                {
                  name: "config",
                  mountPath: "/config",
                  readOnly: true,
                },
                {
                  name: "data",
                  mountPath: "/data",
                },
              ],
              resources: {
                requests: {
                  cpu: "100m",
                  memory: "128Mi",
                },
                limits: {
                  cpu: "500m",
                  memory: "512Mi",
                },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: {
                  drop: ["ALL"],
                },
                seccompProfile: {
                  type: "RuntimeDefault",
                },
              },
            },
          ],
          volumes: [
            {
              name: "config",
              configMap: {
                name: autheliaConfigMap.metadata.name,
              },
            },
            {
              name: "data",
              persistentVolumeClaim: {
                claimName: autheliaPvc.metadata.name,
              },
            },
          ],
        },
      },
    },
  },
  {
    dependsOn: [autheliaNamespace, autheliaConfigMap, autheliaPvc, autheliaSecrets],
  }
);

// Create Service for Authelia
export const autheliaService = new k8s.core.v1.Service(
  "authelia-service",
  {
    metadata: {
      name: "authelia",
      namespace: autheliaNamespace.metadata.name,
    },
    spec: {
      type: "ClusterIP",
      selector: {
        app: "authelia",
      },
      ports: [
        {
          port: 9091,
          targetPort: 9091,
          protocol: "TCP",
          name: "http",
        },
      ],
    },
  },
  {
    dependsOn: [autheliaDeployment],
  }
);

// Create Ingress for Authelia (public access for auth flows)
export const autheliaIngress = new k8s.networking.v1.Ingress(
  "authelia-ingress",
  {
    metadata: {
      name: "authelia",
      namespace: autheliaNamespace.metadata.name,
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-prod",
        "nginx.ingress.kubernetes.io/ssl-redirect": "false", // Cloudflare tunnel
      },
    },
    spec: {
      ingressClassName: "nginx",
      tls: [
        {
          hosts: [pulumi.interpolate`auth.${homelabConfig.require("domain")}`],
          secretName: "authelia-tls",
        },
      ],
      rules: [
        {
          host: pulumi.interpolate`auth.${homelabConfig.require("domain")}`,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: autheliaService.metadata.name,
                    port: {
                      number: 9091,
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
  {
    dependsOn: [autheliaService],
  }
);

// Export service name for ExposedWebApp forward auth
export const autheliaServiceName = autheliaService.metadata.name;
export const autheliaServiceNamespace = autheliaNamespace.metadata.name;
