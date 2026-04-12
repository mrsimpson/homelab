import { homelabConfig } from "@mrsimpson/homelab-config";
import {
  AuthType,
  type CloudflareConfig,
  type HomelabContext,
} from "@mrsimpson/homelab-core-components";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = "opencode-router";
const APP_NAME = "opencode-router";
const ROUTER_PORT = 3000;
const OPENCODE_PORT = 4096;
/** Suffix appended to hash for session hostnames: <hash>-oc.<domain> */
const ROUTE_SUFFIX = "-oc";
/** In-cluster URL the Cloudflare operator routes session traffic to */
const ROUTER_SERVICE_URL = `http://${APP_NAME}.${NAMESPACE}.svc.cluster.local:80`;
/** Operator sidecar image */
const CF_OPERATOR_CONTAINER_NAME = "cloudflare-operator";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface OpencodeRouterConfig {
  /** Image for the opencode-router (e.g. ghcr.io/mrsimpson/opencode-router:0.0.1-homelab.3) */
  routerImage: string | pulumi.Output<string>;
  /** Image for the Cloudflare operator sidecar */
  cfOperatorImage: string | pulumi.Output<string>;
  /** Image for per-user opencode pods (e.g. ghcr.io/mrsimpson/opencode:1.2.27-homelab.6) */
  opencodeImage: string | pulumi.Output<string>;
  /** Anthropic API key (secret) */
  anthropicApiKey: pulumi.Output<string>;
  /**
   * Cloudflare configuration for DNS + tunnel route management.
   * Required for the operator sidecar to provision per-session hostnames.
   * The main DNS record (opencode-router.<domain>) is created automatically
   * by ExposedWebApp via HomelabContext's injected cloudflare config.
   */
  cloudflare?: CloudflareConfig & {
    /** Cloudflare API token (DNS:Edit + Zone:Read + Tunnel:Edit) */
    apiToken: pulumi.Output<string>;
    /** Cloudflare Tunnel ID */
    tunnelId: pulumi.Output<string>;
  };
  /** Optional: git repo to auto-clone for new users */
  defaultGitRepo?: string;
  /** Optional: PVC size per user (default: "2Gi") */
  storageSize?: string;
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
 * - Secret for Cloudflare credentials (used by the operator sidecar)
 * - Cloudflare operator sidecar (via ExposedWebApp extraContainers): watches session
 *   pods and creates/deletes <hash>-oc.<domain> DNS records + tunnel routes on demand.
 *   Session hostnames stay at first-subdomain level → covered by *.no-panic.org Universal SSL.
 *
 * Session URL pattern: https://<hash>-oc.<domain>
 *   e.g. https://abc123def456-oc.no-panic.org
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
  // 2. RBAC — router needs to manage user pods and PVCs at runtime;
  //    operator sidecar needs to watch pods. Both share this ServiceAccount.
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
          verbs: ["get", "list", "watch", "create", "delete", "patch"],
        },
        {
          apiGroups: [""],
          resources: ["persistentvolumeclaims"],
          verbs: ["get", "list", "create"],
        },
        {
          // Operator sidecar creates/deletes per-session IngressRoute resources
          apiGroups: ["traefik.io"],
          resources: ["ingressroutes"],
          verbs: ["get", "list", "create", "delete"],
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
  //    Consumed by user pods at runtime via API_KEY_SECRET_NAME env var.
  // -------------------------------------------------------------------------
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
  void new k8s.core.v1.ConfigMap(
    `${APP_NAME}-config`,
    {
      metadata: {
        name: "opencode-config-dir",
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      data: {
        "opencode.json": JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            model: "anthropic/claude-sonnet-4-5",
          },
          null,
          2
        ),
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
  // 6. Cloudflare credentials Secret (for operator sidecar)
  //    Only created when cloudflare config is provided.
  // -------------------------------------------------------------------------
  const cfSecret = cfg.cloudflare
    ? new k8s.core.v1.Secret(
        `${APP_NAME}-cf-credentials`,
        {
          metadata: {
            name: `${APP_NAME}-cf-credentials`,
            namespace: NAMESPACE,
            labels: { app: APP_NAME },
          },
          type: "Opaque",
          stringData: {
            CF_API_TOKEN: cfg.cloudflare.apiToken,
          },
        },
        { dependsOn: [ns] }
      )
    : null;

  // -------------------------------------------------------------------------
  // 7. Operator sidecar container spec (conditionally added to ExposedWebApp)
  //    Watches session pods and manages <hash>-oc.<domain> DNS + tunnel routes.
  //    Shares the pod's ServiceAccount (pod watch RBAC) and imagePullSecrets.
  // -------------------------------------------------------------------------
  const operatorSidecar = cfg.cloudflare
    ? [
        {
          name: CF_OPERATOR_CONTAINER_NAME,
          image: pulumi.output(cfg.cfOperatorImage),
          securityContext: {
            allowPrivilegeEscalation: false,
            runAsNonRoot: true,
            capabilities: { drop: ["ALL"] },
            seccompProfile: { type: "RuntimeDefault" },
          },
          env: [
            { name: "WATCH_NAMESPACE", value: NAMESPACE },
            {
              name: "POD_LABEL_SELECTOR",
              value: "app.kubernetes.io/managed-by=opencode-router",
            },
            { name: "CF_ZONE_ID", value: pulumi.output(cfg.cloudflare.zoneId) },
            { name: "CF_TUNNEL_ID", value: pulumi.output(cfg.cloudflare.tunnelId) },
            { name: "DOMAIN", value: homelabConfig.domain },
            { name: "ROUTE_SUFFIX", value: ROUTE_SUFFIX },
            { name: "ROUTER_SERVICE_URL", value: ROUTER_SERVICE_URL },
            // IngressRoute management — session routes are created in the same namespace
            // as the opencode-router, reusing its existing oauth2 chain middleware.
            { name: "INGRESSROUTE_NAMESPACE", value: NAMESPACE },
            { name: "OAUTH2_CHAIN_MIDDLEWARE", value: `${APP_NAME}-oauth2-chain` },
            { name: "ROUTER_SERVICE_NAME", value: APP_NAME },
            {
              name: "CF_API_TOKEN",
              valueFrom: {
                secretKeyRef: {
                  name: `${APP_NAME}-cf-credentials`,
                  key: "CF_API_TOKEN",
                },
              },
            },
          ],
          readinessProbe: {
            httpGet: { path: "/healthz", port: 8080 },
            initialDelaySeconds: 5,
            periodSeconds: 10,
          },
          livenessProbe: {
            httpGet: { path: "/healthz", port: 8080 },
            initialDelaySeconds: 15,
            periodSeconds: 30,
          },
          resources: {
            requests: { cpu: "50m", memory: "64Mi" },
            limits: { cpu: "200m", memory: "128Mi" },
          },
        },
      ]
    : [];

  // -------------------------------------------------------------------------
  // 8. ExposedWebApp — Deployment, Service, OAuth2-Proxy auth, main DNS CNAME
  //
  //    Session URLs: <hash>-oc.<domain> (first-level subdomain of homelabConfig.domain)
  //    ROUTER_DOMAIN=<homelabConfig.domain>, ROUTE_SUFFIX=-oc
  //    → covered by Cloudflare Universal SSL *.no-panic.org, no ACM needed.
  //
  //    Note: cloudflare config is NOT passed here — HomelabContext injects it
  //    from the shared infrastructure config, creating the main DNS record
  //    (opencode-router.<domain>) automatically.
  // -------------------------------------------------------------------------
  const domain = pulumi.interpolate`opencode-router.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp(
    APP_NAME,
    {
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
        // ROUTER_DOMAIN is the base domain; sessions are at <hash>-oc.<domain>
        { name: "ROUTER_DOMAIN", value: homelabConfig.domain },
        { name: "ROUTE_SUFFIX", value: ROUTE_SUFFIX },
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
      // Operator sidecar: shares pod SA, pull secrets, and network namespace
      extraContainers: operatorSidecar,
    },
    {
      // Deployment must wait for RBAC (serviceAccountName must exist),
      // GHCR pull secret, and CF credentials secret (if operator is enabled).
      dependsOn: [
        roleBinding,
        pullSecret,
        ...(cfSecret ? [cfSecret] : []),
      ],
    }
  );
  void app;

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
  const url = pulumi.interpolate`https://${domain}`;
  return { url };
}
