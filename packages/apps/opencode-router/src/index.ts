import { homelabConfig } from "@mrsimpson/homelab-config";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";
import type { CloudflareConfig } from "@mrsimpson/homelab-core-components";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = "opencode-router";
const APP_NAME = "opencode-router";
const ROUTER_PORT = 3000;
const OPENCODE_PORT = 4096;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface OpencodeRouterConfig {
  /** Image for the opencode-router (e.g. ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.1) */
  routerImage: string | pulumi.Output<string>;
  /** Image for per-user opencode pods (e.g. ghcr.io/mrsimpson/opencode:1.2.27-homelab.5) */
  opencodeImage: string | pulumi.Output<string>;
  /** Anthropic API key (secret) */
  anthropicApiKey: pulumi.Output<string>;
  /** Optional: git repo to auto-clone for new users */
  defaultGitRepo?: string;
  /** Optional: PVC size per user (default: "2Gi") */
  storageSize?: string;
  /**
   * Cloudflare DNS configuration for creating the DNS record.
   * When omitted, no DNS record is created.
   */
  cloudflare?: CloudflareConfig;
}

export interface OpencodeRouterApp {
  url: pulumi.Output<string>;
}

// ---------------------------------------------------------------------------
// createOpencodeRouter
// ---------------------------------------------------------------------------

/**
 * Deploy the opencode-router as a Kubernetes application.
 *
 * Creates all required resources in the `opencode-router` namespace:
 * - Namespace (with restricted PSS labels)
 * - ServiceAccount, Role, RoleBinding (router needs to manage user pods/PVCs)
 * - Secret for Anthropic API key
 * - ConfigMap with opencode.json for user pods
 * - ExternalSecret for GHCR image pull credentials
 * - Deployment (2 replicas, non-root, readiness/liveness probes)
 * - Service (ClusterIP)
 * - Traefik Middlewares and IngressRoutes (OAuth2-Proxy auth)
 * - Cloudflare DNS CNAME record (when `cfg.cloudflare` is provided)
 *
 * @param homelab - HomelabContext (currently unused but kept for API consistency)
 * @param cfg     - Router deployment configuration
 */
export function createOpencodeRouter(
  _homelab: HomelabContext,
  cfg: OpencodeRouterConfig
): OpencodeRouterApp {
  // -------------------------------------------------------------------------
  // 1. Namespace
  // -------------------------------------------------------------------------
  const ns = new k8s.core.v1.Namespace(`${APP_NAME}-ns`, {
    metadata: {
      name: NAMESPACE,
      labels: {
        app: APP_NAME,
        // Enforce restricted PSS — user pods have proper securityContext (UID 1000, fsGroup 1000)
        "pod-security.kubernetes.io/enforce": "restricted",
        "pod-security.kubernetes.io/enforce-version": "latest",
        "pod-security.kubernetes.io/warn": "restricted",
        "pod-security.kubernetes.io/warn-version": "latest",
      },
    },
  });

  // -------------------------------------------------------------------------
  // 2. ServiceAccount
  // -------------------------------------------------------------------------
  const serviceAccount = new k8s.core.v1.ServiceAccount(
    `${APP_NAME}-sa`,
    {
      metadata: {
        name: APP_NAME,
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
    },
    { dependsOn: [ns] }
  );

  // -------------------------------------------------------------------------
  // 3. Role
  // -------------------------------------------------------------------------
  const role = new k8s.rbac.v1.Role(
    `${APP_NAME}-role`,
    {
      metadata: {
        name: APP_NAME,
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["pods"],
          verbs: ["get", "list", "create", "delete", "patch"],
        },
        {
          apiGroups: [""],
          resources: ["persistentvolumeclaims"],
          verbs: ["get", "list", "create"],
        },
      ],
    },
    { dependsOn: [ns] }
  );

  // -------------------------------------------------------------------------
  // 4. RoleBinding
  // -------------------------------------------------------------------------
  const roleBinding = new k8s.rbac.v1.RoleBinding(
    `${APP_NAME}-rolebinding`,
    {
      metadata: {
        name: APP_NAME,
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: APP_NAME,
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: APP_NAME,
          namespace: NAMESPACE,
        },
      ],
    },
    { dependsOn: [role, serviceAccount] }
  );

  // -------------------------------------------------------------------------
  // 5. Secret (API keys)
  // -------------------------------------------------------------------------
  const apiKeysSecret = new k8s.core.v1.Secret(
    `${APP_NAME}-api-keys`,
    {
      metadata: {
        name: "opencode-api-keys",
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      type: "Opaque",
      stringData: {
        ANTHROPIC_API_KEY: cfg.anthropicApiKey,
      },
    },
    { dependsOn: [ns] }
  );

  // -------------------------------------------------------------------------
  // 6. ConfigMap (opencode.json for user pods)
  // -------------------------------------------------------------------------
  const opencodeJson = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-4-5",
    },
    null,
    2
  );

  const configMap = new k8s.core.v1.ConfigMap(
    `${APP_NAME}-config`,
    {
      metadata: {
        name: "opencode-config-dir",
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      data: {
        "opencode.json": opencodeJson,
      },
    },
    { dependsOn: [ns] }
  );

  // -------------------------------------------------------------------------
  // 7. ExternalSecret (GHCR pull secret)
  // -------------------------------------------------------------------------
  const pullSecret = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-ghcr-pull-secret`,
    {
      apiVersion: "external-secrets.io/v1beta1",
      kind: "ExternalSecret",
      metadata: {
        name: "ghcr-pull-secret",
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      spec: {
        refreshInterval: "1h",
        secretStoreRef: {
          name: "pulumi-esc",
          kind: "ClusterSecretStore",
        },
        target: {
          name: "ghcr-pull-secret",
          creationPolicy: "Owner",
          template: {
            type: "kubernetes.io/dockerconfigjson",
            engineVersion: "v2",
            data: {
              ".dockerconfigjson": `{"auths":{"ghcr.io":{"username":"{{ .github_username }}","password":"{{ .github_token }}","auth":"{{ printf "%s:%s" .github_username .github_token | b64enc }}"}}}`,
            },
          },
        },
        data: [
          {
            secretKey: "github_username",
            remoteRef: {
              key: "github-username",
            },
          },
          {
            secretKey: "github_token",
            remoteRef: {
              key: "github-token",
            },
          },
        ],
      },
    },
    { dependsOn: [ns] }
  );

  // -------------------------------------------------------------------------
  // 8. Deployment
  // -------------------------------------------------------------------------
  const opencodeImageOutput = pulumi.output(cfg.opencodeImage);
  const routerImageOutput = pulumi.output(cfg.routerImage);

  const deployment = new k8s.apps.v1.Deployment(
    `${APP_NAME}-deployment`,
    {
      metadata: {
        name: APP_NAME,
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: APP_NAME } },
        template: {
          metadata: { labels: { app: APP_NAME } },
          spec: {
            serviceAccountName: APP_NAME,
            imagePullSecrets: [{ name: "ghcr-pull-secret" }],
            securityContext: {
              runAsUser: 1000,
              runAsGroup: 1000,
              runAsNonRoot: true,
              fsGroup: 1000,
            },
            containers: [
              {
                name: APP_NAME,
                image: routerImageOutput,
                ports: [{ containerPort: ROUTER_PORT }],
                securityContext: {
                  allowPrivilegeEscalation: false,
                  runAsNonRoot: true,
                  capabilities: { drop: ["ALL"] },
                  seccompProfile: { type: "RuntimeDefault" },
                },
                env: [
                  { name: "OPENCODE_IMAGE", value: opencodeImageOutput },
                  { name: "OPENCODE_NAMESPACE", value: NAMESPACE },
                  { name: "OPENCODE_PORT", value: String(OPENCODE_PORT) },
                  { name: "STORAGE_CLASS", value: "longhorn-uncritical" },
                  { name: "STORAGE_SIZE", value: cfg.storageSize ?? "2Gi" },
                  { name: "API_KEY_SECRET_NAME", value: "opencode-api-keys" },
                  { name: "CONFIG_MAP_NAME", value: "opencode-config-dir" },
                  ...(cfg.defaultGitRepo
                    ? [{ name: "DEFAULT_GIT_REPO", value: cfg.defaultGitRepo }]
                    : []),
                ],
                readinessProbe: {
                  httpGet: {
                    path: "/api/status",
                    port: ROUTER_PORT,
                    httpHeaders: [{ name: "X-Auth-Request-Email", value: "healthcheck@probe" }],
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                  failureThreshold: 3,
                },
                livenessProbe: {
                  httpGet: {
                    path: "/api/status",
                    port: ROUTER_PORT,
                    httpHeaders: [{ name: "X-Auth-Request-Email", value: "healthcheck@probe" }],
                  },
                  initialDelaySeconds: 15,
                  periodSeconds: 30,
                  failureThreshold: 3,
                },
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "256Mi" },
                },
              },
            ],
          },
        },
      },
    },
    {
      dependsOn: [ns, serviceAccount, apiKeysSecret, configMap, pullSecret, roleBinding],
    }
  );

  // -------------------------------------------------------------------------
  // 9. Service
  // -------------------------------------------------------------------------
  const service = new k8s.core.v1.Service(
    `${APP_NAME}-svc`,
    {
      metadata: {
        name: APP_NAME,
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      spec: {
        type: "ClusterIP",
        selector: { app: APP_NAME },
        ports: [{ port: 80, targetPort: ROUTER_PORT, protocol: "TCP" }],
      },
    },
    { dependsOn: [deployment] }
  );

  // -------------------------------------------------------------------------
  // 10-14. Traefik Middlewares and IngressRoutes (OAuth2-Proxy auth)
  // -------------------------------------------------------------------------
  const domain = pulumi.interpolate`opencode-router.${homelabConfig.domain}`;
  const oauth2Group = "users";
  const oauth2Namespace = "oauth2-proxy";
  const oauth2ProxyServiceAddress = `http://oauth2-proxy-${oauth2Group}.${oauth2Namespace}.svc.cluster.local/oauth2/auth`;

  // 10. ForwardAuth middleware
  const forwardAuthMiddleware = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-oauth2-forwardauth`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "Middleware",
      metadata: {
        name: `${APP_NAME}-oauth2-forwardauth`,
        namespace: NAMESPACE,
      },
      spec: {
        forwardAuth: {
          address: oauth2ProxyServiceAddress,
          trustForwardHeader: true,
          authRequestHeaders: ["Cookie", "Authorization"],
          authResponseHeaders: [
            "X-Auth-Request-User",
            "X-Auth-Request-Email",
            "X-Auth-Request-Groups",
            "Set-Cookie",
          ],
        },
      },
    },
    { dependsOn: [service] }
  );

  // 11. Errors middleware
  const errorsMiddleware = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-oauth2-errors`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "Middleware",
      metadata: {
        name: `${APP_NAME}-oauth2-errors`,
        namespace: NAMESPACE,
      },
      spec: {
        errors: {
          status: ["401"],
          service: {
            name: "oauth2-shared-redirect",
            namespace: "oauth2-proxy",
            port: 80,
          },
          query: pulumi.interpolate`/?rd=https://${domain}{url}`,
        },
      },
    },
    { dependsOn: [service] }
  );

  // 12. Chain middleware
  const chainMiddleware = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-oauth2-chain`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "Middleware",
      metadata: {
        name: `${APP_NAME}-oauth2-chain`,
        namespace: NAMESPACE,
      },
      spec: {
        chain: {
          middlewares: [
            { name: `${APP_NAME}-oauth2-errors` },
            { name: `${APP_NAME}-oauth2-forwardauth` },
          ],
        },
      },
    },
    { dependsOn: [errorsMiddleware, forwardAuthMiddleware] }
  );

  // 13. IngressRoute for /oauth2/* (sign-in flow, unprotected)
  const signinRoute = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-oauth2-signin-route`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: {
        name: `${APP_NAME}-oauth2-signin`,
        namespace: NAMESPACE,
      },
      spec: {
        entryPoints: ["web"],
        routes: [
          {
            match: pulumi.interpolate`Host(\`${domain}\`) && PathPrefix(\`/oauth2/\`)`,
            kind: "Rule",
            services: [
              {
                name: `oauth2-proxy-${oauth2Group}`,
                namespace: oauth2Namespace,
                port: 80,
              },
            ],
          },
        ],
      },
    },
    { dependsOn: [ns] }
  );

  // 14. IngressRoute for /* (protected by chain middleware)
  const appRoute = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-oauth2-app-route`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: {
        name: `${APP_NAME}-oauth2-app`,
        namespace: NAMESPACE,
      },
      spec: {
        entryPoints: ["web"],
        routes: [
          {
            match: pulumi.interpolate`Host(\`${domain}\`)`,
            kind: "Rule",
            middlewares: [
              {
                name: `${APP_NAME}-oauth2-chain`,
                namespace: NAMESPACE,
              },
            ],
            services: [
              {
                name: service.metadata.name,
                port: 80,
              },
            ],
            priority: 1,
          },
        ],
      },
    },
    { dependsOn: [service, chainMiddleware, signinRoute] }
  );

  // -------------------------------------------------------------------------
  // 15. Cloudflare DNS Record (optional)
  // -------------------------------------------------------------------------
  if (cfg.cloudflare) {
    new cloudflare.Record(`${APP_NAME}-dns`, {
      zoneId: cfg.cloudflare.zoneId,
      name: pulumi.interpolate`opencode-router.${homelabConfig.domain}`,
      type: "CNAME",
      content: cfg.cloudflare.tunnelCname,
      proxied: true,
      ttl: 1,
    });
  }

  // Suppress unused variable warnings — these are registered in Pulumi state
  void appRoute;

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  const url = pulumi.interpolate`https://${domain}`;
  return { url };
}
