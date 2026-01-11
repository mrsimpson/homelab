import * as k8s from "@pulumi/kubernetes";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Authelia - Simple SQLite-based Authentication Service
 *
 * Provides:
 * - Forward authentication for nginx ingress
 * - OIDC provider for external applications (Supabase)
 * - SQLite backend for homelab simplicity
 *
 * This is a minimal implementation focused on simplicity over enterprise features.
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

// Get configuration
const autheliaConfig = new pulumi.Config("authelia");
const homelabConfig = new pulumi.Config("homelab");

// Create secrets for Authelia environment variables
export const autheliaSecrets = new k8s.core.v1.Secret(
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

// Create Authelia configuration
const autheliaConfigYaml = pulumi
  .all([homelabConfig.require("domain")])
  .apply(([homelabDomain]) => {
    const authDomain = `auth.${homelabDomain}`;
    const sessionDomain = homelabDomain;

    return `---
theme: auto
default_2fa_method: totp

server:
  address: 'tcp://0.0.0.0:9091'
  headers:
    csp_template: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
  # Disable scheme validation for homelab behind proxy
  endpoints:
    authz:
      auth-request:
        implementation: AuthRequest

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

// Create users database
const usersDatabase = pulumi
  .all([
    homelabConfig.require("domain"),
    homelabConfig.get("autheliaAdminUsername") || "admin",
    homelabConfig.requireSecret("autheliaAdminPasswordHash"),
  ])
  .apply(
    ([domain, adminUsername, passwordHash]) => `users:
  ${adminUsername}:
    displayname: "Administrator"
    password: "${passwordHash}"
    email: ${adminUsername}@${domain}
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

// Create PVC for SQLite database
export const autheliaPvc = new k8s.core.v1.PersistentVolumeClaim(
  "authelia-storage",
  {
    metadata: {
      name: "authelia-storage",
      namespace: autheliaNamespace.metadata.name,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn-persistent",
      resources: {
        requests: {
          storage: "1Gi",
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
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { app: "authelia" },
      },
      template: {
        metadata: {
          labels: { app: "authelia" },
        },
        spec: {
          // Critical: Disable service links to prevent env var conflicts
          enableServiceLinks: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            fsGroup: 1000,
          },
          containers: [
            {
              name: "authelia",
              image: "authelia/authelia:4.38.0",
              ports: [{ containerPort: 9091, name: "http" }],
              env: [
                {
                  name: "JWT_SECRET",
                  valueFrom: {
                    secretKeyRef: {
                      name: autheliaSecrets.metadata.name,
                      key: "jwtSecret",
                    },
                  },
                },
                {
                  name: "STORAGE_ENCRYPTION_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: autheliaSecrets.metadata.name,
                      key: "encryptionKey",
                    },
                  },
                },
                // Allow HTTP URLs for homelab behind Cloudflare TLS termination
                {
                  name: "AUTHELIA_SERVER_DISABLE_HEALTHCHECK",
                  value: "true",
                },
                {
                  name: "AUTHELIA_LOG_LEVEL",
                  value: "debug",
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
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "200m", memory: "256Mi" },
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
    dependsOn: [autheliaConfigMap, autheliaSecrets, autheliaPvc],
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
      selector: { app: "authelia" },
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

// Create Ingress for Authelia public access
export const autheliaIngress = new k8s.networking.v1.Ingress(
  "authelia-ingress",
  {
    metadata: {
      name: "authelia",
      namespace: autheliaNamespace.metadata.name,
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-prod",
        "nginx.ingress.kubernetes.io/ssl-redirect": "false",
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

// Get tunnel CNAME from core infrastructure
import { tunnelCname } from "../cloudflare";

export const autheliaDnsRecord = new cloudflare.Record(
  "authelia-dns",
  {
    zoneId: homelabConfig.require("cloudflareZoneId"),
    name: pulumi.interpolate`auth.${homelabConfig.require("domain")}`,
    type: "CNAME",
    content: tunnelCname, // Use the actual Cloudflare tunnel hostname
    proxied: true,
    comment: "Managed by Pulumi - Authelia authentication",
  },
  {
    dependsOn: [autheliaIngress],
  }
);

// Export service name for ExposedWebApp forward auth
export const autheliaServiceName = autheliaService.metadata.name;
export const autheliaServiceNamespace = autheliaNamespace.metadata.name;
