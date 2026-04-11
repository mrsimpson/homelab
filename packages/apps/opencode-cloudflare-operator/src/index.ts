import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_NAME = "opencode-cloudflare-operator";
const NAMESPACE = "opencode-router";
const IMAGE_PORT = 8080; // health/metrics endpoint

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface OpencodeCloudflareOperatorConfig {
  /** Operator container image (e.g. ghcr.io/mrsimpson/opencode-cloudflare-operator:0.1.0) */
  image: string | pulumi.Output<string>;
  /** Cloudflare API token (secret) — must have DNS:Edit and Zone:Read permissions */
  cfApiToken: pulumi.Output<string>;
  /** Cloudflare Zone ID */
  cfZoneId: string | pulumi.Output<string>;
  /** Cloudflare Tunnel ID (for ingress routes) */
  cfTunnelId: string | pulumi.Output<string>;
  /**
   * Base domain for session hostnames (e.g. "no-panic.org").
   * Session DNS record: <hash><routeSuffix>.<domain>
   */
  domain: string | pulumi.Output<string>;
  /**
   * Route suffix appended to the hash (e.g. "-oc").
   * Must match ROUTE_SUFFIX set on the opencode-router deployment.
   */
  routeSuffix: string;
  /**
   * The in-cluster service URL the tunnel routes traffic to.
   * e.g. "http://opencode-router.opencode-router.svc.cluster.local:80"
   * All session hostnames route here; the router dispatches by Host header.
   */
  routerServiceUrl: string | pulumi.Output<string>;
  /** Namespace to watch for session pods (default: "opencode-router") */
  watchNamespace?: string;
  /** Label selector to identify session pods (default: "app.kubernetes.io/managed-by=opencode-router") */
  podLabelSelector?: string;
}

// ---------------------------------------------------------------------------
// createOpencodeCloudflareOperator
// ---------------------------------------------------------------------------

/**
 * Deploy the Cloudflare operator for opencode session routing.
 *
 * The operator watches for session pods (label: app.kubernetes.io/managed-by=opencode-router)
 * in the opencode-router namespace. On pod creation it creates:
 *   - A Cloudflare DNS CNAME record: <hash><suffix>.<domain> → tunnel CNAME
 *   - A Cloudflare Tunnel ingress route: <hash><suffix>.<domain> → router service
 * On pod deletion it removes both.
 *
 * This keeps session hostnames at the first subdomain level (e.g. abc123-oc.no-panic.org),
 * covered by Cloudflare's Universal SSL *.no-panic.org certificate.
 *
 * Resources created:
 * - ServiceAccount, ClusterRole, ClusterRoleBinding (pod watch across namespace)
 * - Secret (Cloudflare credentials)
 * - Deployment (single replica, non-root)
 */
export function createOpencodeCloudflareOperator(
  cfg: OpencodeCloudflareOperatorConfig
): { deployment: k8s.apps.v1.Deployment } {
  const watchNamespace = cfg.watchNamespace ?? NAMESPACE;
  const podLabelSelector =
    cfg.podLabelSelector ?? "app.kubernetes.io/managed-by=opencode-router";

  // -------------------------------------------------------------------------
  // 1. Cloudflare credentials Secret
  // -------------------------------------------------------------------------
  const cfSecret = new k8s.core.v1.Secret(`${APP_NAME}-cf-credentials`, {
    metadata: {
      name: `${APP_NAME}-cf-credentials`,
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
    type: "Opaque",
    stringData: {
      CF_API_TOKEN: cfg.cfApiToken,
    },
  });

  // -------------------------------------------------------------------------
  // 2. ServiceAccount
  // -------------------------------------------------------------------------
  const serviceAccount = new k8s.core.v1.ServiceAccount(`${APP_NAME}-sa`, {
    metadata: {
      name: APP_NAME,
      namespace: NAMESPACE,
      labels: { app: APP_NAME },
    },
  });

  // -------------------------------------------------------------------------
  // 3. Role — watch pods in the opencode-router namespace
  //    (Role not ClusterRole: operator only needs access to one namespace)
  // -------------------------------------------------------------------------
  const role = new k8s.rbac.v1.Role(
    `${APP_NAME}-role`,
    {
      metadata: {
        name: APP_NAME,
        namespace: watchNamespace,
        labels: { app: APP_NAME },
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["pods"],
          verbs: ["get", "list", "watch"],
        },
      ],
    },
    { dependsOn: [serviceAccount] }
  );

  const roleBinding = new k8s.rbac.v1.RoleBinding(
    `${APP_NAME}-rolebinding`,
    {
      metadata: {
        name: APP_NAME,
        namespace: watchNamespace,
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
    { dependsOn: [role] }
  );

  // -------------------------------------------------------------------------
  // 4. Deployment
  // -------------------------------------------------------------------------
  const deployment = new k8s.apps.v1.Deployment(
    `${APP_NAME}-deployment`,
    {
      metadata: {
        name: APP_NAME,
        namespace: NAMESPACE,
        labels: { app: APP_NAME },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: APP_NAME } },
        template: {
          metadata: { labels: { app: APP_NAME } },
          spec: {
            serviceAccountName: APP_NAME,
            securityContext: {
              runAsUser: 1000,
              runAsGroup: 1000,
              runAsNonRoot: true,
              fsGroup: 1000,
            },
            containers: [
              {
                name: "operator",
                image: pulumi.output(cfg.image),
                ports: [{ containerPort: IMAGE_PORT, name: "health" }],
                securityContext: {
                  allowPrivilegeEscalation: false,
                  runAsNonRoot: true,
                  capabilities: { drop: ["ALL"] },
                  seccompProfile: { type: "RuntimeDefault" },
                },
                env: [
                  { name: "WATCH_NAMESPACE", value: watchNamespace },
                  { name: "POD_LABEL_SELECTOR", value: podLabelSelector },
                  { name: "CF_ZONE_ID", value: pulumi.output(cfg.cfZoneId) },
                  { name: "CF_TUNNEL_ID", value: pulumi.output(cfg.cfTunnelId) },
                  { name: "DOMAIN", value: pulumi.output(cfg.domain) },
                  { name: "ROUTE_SUFFIX", value: cfg.routeSuffix },
                  { name: "ROUTER_SERVICE_URL", value: pulumi.output(cfg.routerServiceUrl) },
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
                  httpGet: { path: "/healthz", port: IMAGE_PORT },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/healthz", port: IMAGE_PORT },
                  initialDelaySeconds: 15,
                  periodSeconds: 30,
                },
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits: { cpu: "200m", memory: "128Mi" },
                },
              },
            ],
          },
        },
      },
    },
    { dependsOn: [roleBinding, cfSecret] }
  );

  return { deployment };
}
