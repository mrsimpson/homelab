import { homelabConfig } from "@mrsimpson/homelab-config";
import {
  AuthType,
  type CloudflareConfig,
  type HomelabContext,
} from "@mrsimpson/homelab-core-components";
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
   * Cloudflare DNS configuration.
   * Used for both the main DNS record (opencode-router.<domain>) via ExposedWebApp,
   * and the wildcard session subdomain record (*.opencode-router.<domain>).
   * When omitted, no DNS records are created.
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
 * Deploy the opencode-router as a Kubernetes application using ExposedWebApp.
 *
 * ExposedWebApp handles: Deployment, Service, OAuth2-Proxy auth (middlewares +
 * IngressRoutes), main DNS CNAME, and GHCR pull secret (via ExternalSecret).
 *
 * This function supplements with app-specific resources:
 * - Namespace (pre-created with restricted PSS, passed to ExposedWebApp)
 * - ServiceAccount, Role, RoleBinding (router manages user pods/PVCs at runtime)
 * - ExternalSecret for GHCR image pull credentials (explicit: namespace is pre-created,
 *   so ExposedWebApp's auto-create path is skipped)
 * - Secret for Anthropic API key
 * - ConfigMap with opencode.json for user pods
 * - Wildcard IngressRoute for session subdomains (*.opencode-router.<domain>)
 * - Wildcard Cloudflare DNS record (when `cfg.cloudflare` is provided)
 */
export function createOpencodeRouter(
  homelab: HomelabContext,
  cfg: OpencodeRouterConfig
): OpencodeRouterApp {
  // -------------------------------------------------------------------------
  // 1. Namespace (pre-created, passed to ExposedWebApp)
  // -------------------------------------------------------------------------
  const ns = new k8s.core.v1.Namespace(`${APP_NAME}-ns`, {
    metadata: {
      name: NAMESPACE,
      labels: {
        app: APP_NAME,
        "pod-security.kubernetes.io/enforce": "restricted",
        "pod-security.kubernetes.io/enforce-version": "latest",
        "pod-security.kubernetes.io/warn": "restricted",
        "pod-security.kubernetes.io/warn-version": "latest",
      },
    },
  });

  // -------------------------------------------------------------------------
  // 2. RBAC — router needs to manage user pods and PVCs at runtime
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
  // 3. Secret (API keys for user pods)
  // -------------------------------------------------------------------------
  // apiKeysSecret and configMap are consumed by user pods at runtime (not by the
  // router deployment). The router passes their names via API_KEY_SECRET_NAME and
  // CONFIG_MAP_NAME env vars, so they just need to exist in the namespace.
  void new k8s.core.v1.Secret(
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
  // 4. ConfigMap (opencode.json for user pods)
  // -------------------------------------------------------------------------
  const opencodeJson = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-4-5",
    },
    null,
    2
  );

  void new k8s.core.v1.ConfigMap(
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
  // 5. ExternalSecret (GHCR pull secret)
  //    Explicitly created here because ExposedWebApp's auto-create only fires
  //    when it creates the namespace itself (isCreatingNamespace). Since we
  //    pre-create the namespace above and pass it in, we must create this manually.
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
            remoteRef: { key: "github-username" },
          },
          {
            secretKey: "github_token",
            remoteRef: { key: "github-token" },
          },
        ],
      },
    },
    { dependsOn: [ns] }
  );

  // -------------------------------------------------------------------------
  // 6. ExposedWebApp — handles Deployment, Service, OAuth2-Proxy auth,
  //    main DNS CNAME, and GHCR pull secret dependency
  // -------------------------------------------------------------------------
  const domain = pulumi.interpolate`opencode-router.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp(APP_NAME, {
    namespace: ns,
    image: pulumi.output(cfg.routerImage),
    domain,
    port: ROUTER_PORT,
    replicas: 2,
    auth: AuthType.OAUTH2_PROXY,
    oauth2Proxy: { group: "users" },
    serviceAccountName: APP_NAME,
    imagePullSecrets: [{ name: "ghcr-pull-secret" }],
    securityContext: {
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
    },
    resources: {
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { cpu: "500m", memory: "256Mi" },
    },
    env: [
      { name: "OPENCODE_IMAGE", value: pulumi.output(cfg.opencodeImage) },
      { name: "OPENCODE_NAMESPACE", value: NAMESPACE },
      { name: "OPENCODE_PORT", value: String(OPENCODE_PORT) },
      { name: "STORAGE_CLASS", value: "longhorn-uncritical" },
      { name: "STORAGE_SIZE", value: cfg.storageSize ?? "2Gi" },
      { name: "API_KEY_SECRET_NAME", value: "opencode-api-keys" },
      { name: "CONFIG_MAP_NAME", value: "opencode-config-dir" },
      { name: "IMAGE_PULL_SECRET_NAME", value: "ghcr-pull-secret" },
      {
        name: "ROUTER_DOMAIN",
        value: pulumi.interpolate`opencode-router.${homelabConfig.domain}`,
      },
      ...(cfg.defaultGitRepo
        ? [{ name: "DEFAULT_GIT_REPO", value: cfg.defaultGitRepo }]
        : []),
    ],
    probes: {
      readinessProbe: {
        httpGet: {
          path: "/api/sessions",
          port: ROUTER_PORT,
          httpHeaders: [{ name: "X-Auth-Request-Email", value: "healthcheck@probe" }],
        },
        initialDelaySeconds: 5,
        periodSeconds: 10,
        failureThreshold: 3,
      },
      livenessProbe: {
        httpGet: {
          path: "/api/sessions",
          port: ROUTER_PORT,
          httpHeaders: [{ name: "X-Auth-Request-Email", value: "healthcheck@probe" }],
        },
        initialDelaySeconds: 15,
        periodSeconds: 30,
        failureThreshold: 3,
      },
    },
    // Note: cloudflare config is NOT passed here — HomelabContext injects it
    // from the shared infrastructure config. The main DNS record
    // (opencode-router.<domain>) is created automatically by ExposedWebApp
    // using the cloudflare config from HomelabContext.
  }, {
    // Deployment must wait for RBAC (serviceAccountName must exist) and the
    // GHCR pull secret (imagePullSecrets references it).
    dependsOn: [roleBinding, pullSecret],
  });

  // -------------------------------------------------------------------------
  // 7. Wildcard IngressRoute for session subdomains
  //    Each session is served at https://<hash>.opencode-router.<domain>.
  //    The router reads the Host header subdomain to identify the session.
  //    Reuses the OAuth2-Proxy chain middleware created by ExposedWebApp.
  // -------------------------------------------------------------------------
  const sessionRoute = new k8s.apiextensions.CustomResource(
    `${APP_NAME}-session-route`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: {
        name: `${APP_NAME}-session`,
        namespace: NAMESPACE,
      },
      spec: {
        entryPoints: ["web"],
        routes: [
          {
            match: pulumi.interpolate`HostRegexp(\`{hash:[a-f0-9]{12}}.opencode-router.${homelabConfig.domain}\`)`,
            kind: "Rule",
            middlewares: [
              {
                // Deterministic name from ExposedWebApp's OAuth2-Proxy chain middleware
                name: `${APP_NAME}-oauth2-chain`,
                namespace: NAMESPACE,
              },
            ],
            services: [
              {
                name: app.service.metadata.name,
                port: 80,
              },
            ],
          },
        ],
      },
    },
    {
      // Depend on ExposedWebApp's routes to ensure the chain middleware exists
      dependsOn: Array.isArray(app.route) ? app.route : [app.route],
    }
  );
  void sessionRoute;

  // -------------------------------------------------------------------------
  // 8. Wildcard Cloudflare DNS + Advanced Certificate for session subdomains
  //    The main DNS record (opencode-router.<domain>) is created by ExposedWebApp
  //    via HomelabContext's injected cloudflare config.
  //
  //    Cloudflare Universal SSL only covers *.no-panic.org (one level deep).
  //    Session subdomains (*.opencode-router.no-panic.org) are two levels deep
  //    and require an Advanced Certificate Pack with DNS-01 validation.
  // -------------------------------------------------------------------------
  if (cfg.cloudflare) {
    void new cloudflare.Record(`${APP_NAME}-dns-wildcard`, {
      zoneId: cfg.cloudflare.zoneId,
      name: pulumi.interpolate`*.opencode-router.${homelabConfig.domain}`,
      type: "CNAME",
      content: cfg.cloudflare.tunnelCname,
      proxied: true,
      ttl: 1,
    });

    void new cloudflare.CertificatePack(`${APP_NAME}-cert`, {
      zoneId: cfg.cloudflare.zoneId,
      type: "advanced",
      hosts: [
        pulumi.interpolate`opencode-router.${homelabConfig.domain}`,
        pulumi.interpolate`*.opencode-router.${homelabConfig.domain}`,
      ],
      validationMethod: "txt",
      validityDays: 90,
      certificateAuthority: "lets_encrypt",
      waitForActiveStatus: false,
    });
  }

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  const url = pulumi.interpolate`https://${domain}`;
  return { url };
}
