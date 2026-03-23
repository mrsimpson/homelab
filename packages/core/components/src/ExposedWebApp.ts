import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * ExposedWebApp — reusable Pulumi component for deploying web apps with secure internet exposure.
 *
 * Handles the full stack: Deployment → Service → HTTPRoute/IngressRoute → TLS → DNS.
 *
 * ## Authentication modes
 * - `AuthType.NONE`         — no auth, public access
 * - `AuthType.FORWARD`      — Authelia forward-auth via Traefik ForwardAuth middleware
 * - `AuthType.OAUTH2_PROXY` — GitHub OAuth via the shared oauth2-proxy IngressRoute
 *
 * ## What gets created automatically
 * - `Namespace` (with Pod Security Standards labels, unless you pass your own)
 * - `Deployment` + `Service` (ClusterIP)
 * - `HTTPRoute` or `IngressRoute[]` depending on auth mode
 * - Optional `PersistentVolumeClaim` (when `storage` is set)
 * - Optional Cloudflare DNS `Record` (when `cloudflare` is set)
 * - Optional `ExternalSecret` for GHCR pull credentials (when `imagePullSecrets` references `ghcr-pull-secret`)
 *
 * ## Key options
 *
 * ### Container overrides
 * - `command` / `args` — override entrypoint / arguments (e.g. `args: ["web", "--port", "4096"]`)
 *
 * ### Extra volumes
 * - `extraVolumes` / `extraVolumeMounts` — inject additional volumes (ConfigMaps, hostPath, etc.)
 *   alongside the built-in storage PVC mount.
 *
 * ### Node pinning
 * - `nodeSelector` — pin the pod to specific node(s) by label.
 *   **Required when using hostPath volumes**, which are node-local by definition.
 *   Example: `{ "kubernetes.io/hostname": "flinker" }`
 *
 * ### Security context
 * - `securityContext.runAsUser/Group/fsGroup` — UID/GID for the container and volume ownership.
 * - `securityContext.allowRoot` — set to `true` only when the image genuinely requires UID 0.
 *   Automatically relaxes the namespace Pod Security Standard from `restricted` to `baseline`.
 *   Also disables `runAsNonRoot` on the pod and container security contexts.
 *   Prefer fixing the image to run as non-root instead of using this flag.
 * - `extraVolumes` with `hostPath` — automatically relaxes the namespace PSS to `privileged`
 *   (the only level that permits hostPath volumes per the Kubernetes PSS spec).
 *   The pod itself still runs as non-root with all capabilities dropped.
 *
 * ## Example
 * ```typescript
 * homelab.createExposedWebApp("blog", {
 *   image: "ghost:5",
 *   domain: pulumi.interpolate`blog.${homelabConfig.domain}`,
 *   port: 2368,
 *   auth: AuthType.OAUTH2_PROXY,
 *   storage: { size: "10Gi", mountPath: "/var/lib/ghost/content" },
 *   nodeSelector: { "kubernetes.io/hostname": "flinker" },
 *   extraVolumes: [{ name: "cfg", configMap: { name: "blog-config" } }],
 *   extraVolumeMounts: [{ name: "cfg", mountPath: "/etc/blog" }],
 * });
 * ```
 */

/**
 * Authentication type for ExposedWebApp
 */
export enum AuthType {
  /** No authentication required */
  NONE = "none",
  /** Authelia forward authentication via Traefik ForwardAuth middleware */
  FORWARD = "forward",
  /** OAuth2-Proxy authentication via GitHub OAuth (uses IngressRoute instead of HTTPRoute) */
  OAUTH2_PROXY = "oauth2",
}

export interface StorageConfig {
  size: string;
  mountPath: string;
  storageClass?: string;
}

export interface CloudflareConfig {
  /** Cloudflare Zone ID for creating DNS records */
  zoneId: string | pulumi.Output<string>;
  /** CNAME value for DNS record (usually the Cloudflare Tunnel hostname) */
  tunnelCname: string | pulumi.Output<string>;
}

export interface TLSConfig {
  /** ClusterIssuer resource for automatic TLS certificate provisioning */
  clusterIssuer?: k8s.apiextensions.CustomResource;
  /** Name of the ClusterIssuer (if not providing the resource) */
  clusterIssuerName?: string | pulumi.Output<string>;
}

export interface GatewayApiConfig {
  /** Gateway class name (defaults to "traefik") */
  gatewayClass?: string;
  /** Gateway name (defaults to "homelab-gateway") */
  gatewayName?: string;
  /** Gateway namespace (defaults to "traefik-system") */
  gatewayNamespace?: string;
  /** ForwardAuth middleware name for authentication (defaults to "authelia-forwardauth") */
  forwardAuthMiddleware?: string;
  /** Gateway controller resource to depend on */
  controller?: pulumi.Resource;
}

export interface ExternalSecretsConfig {
  /** External Secrets Operator resource to depend on */
  operator?: pulumi.Resource;
  /** ClusterSecretStore name (defaults to "pulumi-esc") */
  storeName?: string;
}

export interface OAuth2ProxyConfig {
  /** Which oauth2-proxy group to use (defaults to "users") */
  group?: string;
  /** Namespace where oauth2-proxy is deployed (defaults to "oauth2-proxy") */
  namespace?: string;
}

export interface ExposedWebAppArgs {
  /** Container image to deploy */
  image: string;
  /** Fully qualified domain name */
  domain: string | pulumi.Output<string>;
  /** Container port */
  port: number;
  /** Number of replicas (defaults to 1) */
  replicas?: number;
  /** Override the container entrypoint (maps to K8s container.command) */
  command?: string[];
  /** Container arguments (maps to K8s container.args) */
  args?: string[];
  /** Environment variables */
  env?: Array<{ name: string; value: string | pulumi.Output<string> }>;
  /** Authentication type (defaults to "none") */
  auth?: AuthType;
  /** Persistent storage configuration */
  storage?: StorageConfig;
  /** Resource requests and limits */
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  /** Tags for organizing resources */
  tags?: string[];
  /** ImagePullSecrets for private container registries (e.g., GHCR, ECR) */
  imagePullSecrets?: Array<{ name: string }>;
  /** Security context configuration for pod and container */
  securityContext?: {
    runAsUser?: number;
    runAsGroup?: number;
    fsGroup?: number;
    /**
     * Set to true only when the container image requires root (UID 0) to function.
     * This disables the `runAsNonRoot` enforcement on both the pod and container security
     * contexts, and relaxes the namespace Pod Security Standard to "baseline".
     * Use with caution — prefer fixing the image to run as non-root instead.
     */
    allowRoot?: boolean;
  };
  /** Optional pre-created namespace (if not provided, will create one) */
  namespace?: k8s.core.v1.Namespace;
  /**
   * Pin the pod to specific node(s) using Kubernetes nodeSelector labels.
   * Required when using hostPath volumes (which are node-local by definition).
   * Example: { "kubernetes.io/hostname": "flinker" }
   */
  nodeSelector?: Record<string, string>;
  /** Extra volumes to add to the pod spec (in addition to the optional storage PVC) */
  extraVolumes?: object[];
  /** Extra volume mounts to add to the app container (in addition to the optional storage mount) */
  extraVolumeMounts?: object[];
  /**
   * Init containers to run before the main app container starts.
   * Useful for seeding files into emptyDir volumes or other pre-start setup.
   * Each entry is a full Kubernetes container spec object.
   */
  initContainers?: object[];

  // Infrastructure dependencies (all optional)
  /** Cloudflare DNS configuration */
  cloudflare?: CloudflareConfig;
  /** TLS/cert-manager configuration */
  tls?: TLSConfig;
  /** Gateway API configuration */
  gatewayApi?: GatewayApiConfig;
  /** External Secrets Operator configuration */
  externalSecrets?: ExternalSecretsConfig;
  /** OAuth2-Proxy configuration (required when auth is OAUTH2_PROXY) */
  oauth2Proxy?: OAuth2ProxyConfig;
}

export class ExposedWebApp extends pulumi.ComponentResource {
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  /** Route resource(s): single HTTPRoute (Authelia/NONE) or IngressRoute[] (OAuth2-Proxy) */
  public readonly route: k8s.apiextensions.CustomResource | k8s.apiextensions.CustomResource[];
  public readonly forwardAuthMiddleware?: k8s.apiextensions.CustomResource;
  public readonly dnsRecord?: cloudflare.Record;
  public readonly pvc?: k8s.core.v1.PersistentVolumeClaim;

  constructor(name: string, args: ExposedWebAppArgs, opts?: pulumi.ComponentResourceOptions) {
    super("homelab:ExposedWebApp", name, {}, opts);

    const childOpts = { parent: this };

    // Use provided namespace or create a new one
    const isCreatingNamespace = !args.namespace;
    // Pod Security Standard level for the namespace:
    // - "restricted": default, enforces non-root, no hostPath, etc.
    // - "baseline":   required when allowRoot is set (permits running as UID 0)
    // - "privileged": required when hostPath volumes are present (hostPath is
    //                 forbidden even in baseline per the K8s PSS spec)
    const hasHostPath = args.extraVolumes?.some(
      (v) => typeof v === "object" && v !== null && "hostPath" in v
    );
    const podSecurityLevel = hasHostPath
      ? "privileged"
      : args.securityContext?.allowRoot
        ? "baseline"
        : "restricted";
    const namespace =
      args.namespace ||
      new k8s.core.v1.Namespace(
        `${name}-ns`,
        {
          metadata: {
            name: name,
            labels: {
              app: name,
              environment: pulumi.getStack(),
              // Pod Security Standards — relaxed to "baseline" when the image requires root
              "pod-security.kubernetes.io/enforce": podSecurityLevel,
              "pod-security.kubernetes.io/audit": podSecurityLevel,
              "pod-security.kubernetes.io/warn": podSecurityLevel,
            },
          },
        },
        childOpts
      );

    // If creating a new namespace AND imagePullSecrets are specified,
    // automatically create ExternalSecrets for common pull secret names
    const pullSecretResources: k8s.apiextensions.CustomResource[] = [];
    if (isCreatingNamespace && args.imagePullSecrets && args.externalSecrets) {
      const storeName = args.externalSecrets.storeName || "pulumi-esc";

      // Create dependencies for ExternalSecret
      const externalSecretDeps: pulumi.Resource[] = [namespace];
      if (args.externalSecrets.operator) {
        externalSecretDeps.push(args.externalSecrets.operator);
      }

      args.imagePullSecrets.forEach((pullSecret) => {
        // Only auto-create for known secret names to avoid creating unnecessary resources
        if (pullSecret.name === "ghcr-pull-secret") {
          pullSecretResources.push(
            new k8s.apiextensions.CustomResource(
              `${name}-ghcr-pull-secret`,
              {
                apiVersion: "external-secrets.io/v1beta1",
                kind: "ExternalSecret",
                metadata: {
                  name: "ghcr-pull-secret",
                  namespace: namespace.metadata.name,
                },
                spec: {
                  refreshInterval: "1h",
                  secretStoreRef: {
                    name: storeName,
                    kind: "ClusterSecretStore",
                  },
                  target: {
                    name: "ghcr-pull-secret",
                    creationPolicy: "Owner",
                    template: {
                      type: "kubernetes.io/dockerconfigjson",
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
              { ...childOpts, dependsOn: externalSecretDeps }
            )
          );
        } else if (pullSecret.name === "dockerhub-pull-secret") {
          pullSecretResources.push(
            new k8s.apiextensions.CustomResource(
              `${name}-dockerhub-pull-secret`,
              {
                apiVersion: "external-secrets.io/v1beta1",
                kind: "ExternalSecret",
                metadata: {
                  name: "dockerhub-pull-secret",
                  namespace: namespace.metadata.name,
                },
                spec: {
                  refreshInterval: "1h",
                  secretStoreRef: {
                    name: storeName,
                    kind: "ClusterSecretStore",
                  },
                  target: {
                    name: "dockerhub-pull-secret",
                    creationPolicy: "Owner",
                    template: {
                      type: "kubernetes.io/dockerconfigjson",
                      data: {
                        ".dockerconfigjson": `{
  "auths": {
    "https://index.docker.io/v1/": {
      "username": "{{ .dockerhub_username }}",
      "password": "{{ .dockerhub_token }}",
      "auth": "{{ printf "%s:%s" .dockerhub_username .dockerhub_token | b64enc }}"
    }
  }
}`,
                      },
                    },
                  },
                  data: [
                    {
                      secretKey: "dockerhub_username",
                      remoteRef: {
                        key: "dockerhub-credentials/username",
                      },
                    },
                    {
                      secretKey: "dockerhub_token",
                      remoteRef: {
                        key: "dockerhub-credentials/token",
                      },
                    },
                  ],
                },
              },
              { ...childOpts, dependsOn: externalSecretDeps }
            )
          );
        }
      });
    }

    // Optional: Create PVC for persistent storage
    if (args.storage) {
      this.pvc = new k8s.core.v1.PersistentVolumeClaim(
        `${name}-pvc`,
        {
          metadata: {
            name: `${name}-storage`,
            namespace: namespace.metadata.name,
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: args.storage.storageClass || "local-path",
            resources: {
              requests: {
                storage: args.storage.size,
              },
            },
          },
        },
        childOpts
      );
    }

    // Main application container
    const appContainer: any = {
      name: "app",
      image: args.image,
      ports: [
        {
          containerPort: args.port,
          name: "http",
        },
      ],
      env: args.env || [],
      resources: args.resources || {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "512Mi" },
      },
      securityContext: {
        allowPrivilegeEscalation: false,
        // Only enforce runAsNonRoot when the image supports it (opt-out via allowRoot)
        ...(args.securityContext?.allowRoot ? {} : { runAsNonRoot: true }),
        capabilities: {
          drop: ["ALL"],
        },
        seccompProfile: {
          type: "RuntimeDefault",
        },
      },
    };

    // Add optional command / args overrides
    if (args.command) {
      appContainer.command = args.command;
    }
    if (args.args) {
      appContainer.args = args.args;
    }

    // Build volume mounts: storage PVC mount + any extra mounts
    const volumeMounts: object[] = [];
    if (args.storage && this.pvc) {
      volumeMounts.push({
        name: "storage",
        mountPath: args.storage.mountPath,
      });
    }
    if (args.extraVolumeMounts) {
      volumeMounts.push(...args.extraVolumeMounts);
    }
    if (volumeMounts.length > 0) {
      appContainer.volumeMounts = volumeMounts;
    }

    // Build volumes list: storage PVC + any extra volumes
    const volumes: any[] = [];
    if (args.storage && this.pvc) {
      volumes.push({
        name: "storage",
        persistentVolumeClaim: {
          claimName: this.pvc.metadata.name,
        },
      });
    }
    if (args.extraVolumes) {
      volumes.push(...args.extraVolumes);
    }

    // Create Deployment
    // Build deployment dependencies - include pull secrets if we created them
    const deploymentDeps: pulumi.Resource[] = [namespace, ...pullSecretResources];

    this.deployment = new k8s.apps.v1.Deployment(
      `${name}-deployment`,
      {
        metadata: {
          name: name,
          namespace: namespace.metadata.name,
          labels: {
            app: name,
            environment: pulumi.getStack(),
          },
        },
        spec: {
          replicas: args.replicas || 1,
          selector: {
            matchLabels: {
              app: name,
            },
          },
          template: {
            metadata: {
              labels: {
                app: name,
              },
            },
            spec: {
              imagePullSecrets: args.imagePullSecrets,
              nodeSelector: args.nodeSelector,
              securityContext: {
                // Only enforce runAsNonRoot when the image supports it (opt-out via allowRoot)
                ...(args.securityContext?.allowRoot ? {} : { runAsNonRoot: true }),
                // When allowRoot is true, omit runAsUser/runAsGroup to let the image use its own UID
                ...(args.securityContext?.allowRoot
                  ? {}
                  : {
                      runAsUser: args.securityContext?.runAsUser || 1000,
                      runAsGroup: args.securityContext?.runAsGroup || 1000,
                    }),
                fsGroup: args.securityContext?.allowRoot
                  ? undefined
                  : args.securityContext?.fsGroup || 1000,
              },
              containers: [appContainer],
              initContainers: args.initContainers as
                | k8s.types.input.core.v1.Container[]
                | undefined,
              volumes: volumes.length > 0 ? volumes : undefined,
            },
          },
        },
      },
      { ...childOpts, dependsOn: deploymentDeps }
    );

    // Create Service
    this.service = new k8s.core.v1.Service(
      `${name}-service`,
      {
        metadata: {
          name: name,
          namespace: namespace.metadata.name,
        },
        spec: {
          type: "ClusterIP",
          selector: {
            app: name,
          },
          ports: [
            {
              port: 80,
              targetPort: args.port,
              protocol: "TCP",
              name: "http",
            },
          ],
        },
      },
      { ...childOpts, dependsOn: [this.deployment] }
    );

    // --- Routing & Authentication ---
    // OAuth2-Proxy uses IngressRoute (Traefik CRD) for reliable cross-namespace support
    // Authelia and NONE use Gateway API HTTPRoute

    if (args.auth === AuthType.OAUTH2_PROXY) {
      // --- OAuth2-Proxy: IngressRoute-based routing ---
      const oauth2Group = args.oauth2Proxy?.group || "users";
      const oauth2Namespace = args.oauth2Proxy?.namespace || "oauth2-proxy";
      const oauth2ProxyServiceAddress = `http://oauth2-proxy-${oauth2Group}.${oauth2Namespace}.svc.cluster.local/oauth2/auth`;

      // ForwardAuth middleware - checks session via /oauth2/auth
      this.forwardAuthMiddleware = new k8s.apiextensions.CustomResource(
        `${name}-oauth2-forwardauth`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "Middleware",
          metadata: {
            name: `${name}-oauth2-forwardauth`,
            namespace: namespace.metadata.name,
          },
          spec: {
            forwardAuth: {
              address: oauth2ProxyServiceAddress,
              trustForwardHeader: true,
              // CRITICAL: Forward Cookie header so oauth2-proxy can see the session
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
        { ...childOpts, dependsOn: [this.service] }
      );

      // Use shared redirect service from oauth2-proxy namespace
      // This eliminates per-app ConfigMap + Deployment + Service (3 resources saved!)

      // Errors middleware - catches 401 and serves redirect page from shared service
      const errorsMiddleware = new k8s.apiextensions.CustomResource(
        `${name}-oauth2-errors`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "Middleware",
          metadata: {
            name: `${name}-oauth2-errors`,
            namespace: namespace.metadata.name,
          },
          spec: {
            errors: {
              status: ["401"],
              service: {
                // Use ExternalName service to reference shared redirect service in oauth2-proxy namespace
                name: "oauth2-shared-redirect",
                namespace: "oauth2-proxy",
                port: 80,
              },
              query: pulumi.interpolate`/?rd=https://${args.domain}{url}`,
            },
          },
        },
        { ...childOpts, dependsOn: [this.service] }
      );

      // Chain middleware - errors wraps forwardauth
      const chainMiddleware = new k8s.apiextensions.CustomResource(
        `${name}-oauth2-chain`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "Middleware",
          metadata: {
            name: `${name}-oauth2-chain`,
            namespace: namespace.metadata.name,
          },
          spec: {
            chain: {
              middlewares: [
                { name: `${name}-oauth2-errors` },
                { name: `${name}-oauth2-forwardauth` },
              ],
            },
          },
        },
        { ...childOpts, dependsOn: [errorsMiddleware, this.forwardAuthMiddleware] }
      );

      // IngressRoute 1: /oauth2/* → oauth2-proxy (unprotected, handles sign-in flow)
      const signinRoute = new k8s.apiextensions.CustomResource(
        `${name}-oauth2-signin-route`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "IngressRoute",
          metadata: {
            name: `${name}-oauth2-signin`,
            namespace: namespace.metadata.name,
          },
          spec: {
            // Use "web" entryPoint: Cloudflare terminates TLS, traffic arrives as HTTP
            entryPoints: ["web"],
            routes: [
              {
                match: pulumi.interpolate`Host(\`${args.domain}\`) && PathPrefix(\`/oauth2/\`)`,
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
        { ...childOpts, dependsOn: [namespace] }
      );

      // IngressRoute 2: /* → app backend (protected by middleware chain)
      const appRoute = new k8s.apiextensions.CustomResource(
        `${name}-oauth2-app-route`,
        {
          apiVersion: "traefik.io/v1alpha1",
          kind: "IngressRoute",
          metadata: {
            name: `${name}-oauth2-app`,
            namespace: namespace.metadata.name,
          },
          spec: {
            entryPoints: ["web"],
            routes: [
              {
                match: pulumi.interpolate`Host(\`${args.domain}\`)`,
                kind: "Rule",
                middlewares: [
                  {
                    name: `${name}-oauth2-chain`,
                    namespace: namespace.metadata.name,
                  },
                ],
                services: [
                  {
                    name: this.service.metadata.name,
                    port: 80,
                  },
                ],
                priority: 1, // Lower priority than /oauth2/* route
              },
            ],
          },
        },
        { ...childOpts, dependsOn: [this.service, chainMiddleware, signinRoute] }
      );

      this.route = [signinRoute, appRoute];
    } else {
      // --- Authelia / NONE: Gateway API HTTPRoute ---

      const gatewayName = args.gatewayApi?.gatewayName || "homelab-gateway";
      const gatewayNamespace = args.gatewayApi?.gatewayNamespace || "traefik-system";

      // Build Gateway API dependencies
      const httpRouteDeps: pulumi.Resource[] = [this.service];
      if (args.gatewayApi?.controller) {
        httpRouteDeps.push(args.gatewayApi.controller);
      }
      if (args.tls?.clusterIssuer) {
        httpRouteDeps.push(args.tls.clusterIssuer);
      }

      // Create ForwardAuth middleware for Authelia
      if (args.auth === AuthType.FORWARD) {
        this.forwardAuthMiddleware = new k8s.apiextensions.CustomResource(
          `${name}-forwardauth`,
          {
            apiVersion: "traefik.io/v1alpha1",
            kind: "Middleware",
            metadata: {
              name: `forwardauth`,
              namespace: namespace.metadata.name,
            },
            spec: {
              forwardAuth: {
                address: "http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request",
                trustForwardHeader: true,
                authRequestHeaders: [
                  "X-Original-URL",
                  "X-Original-Method",
                  "X-Forwarded-Host",
                  "X-Forwarded-Proto",
                  "X-Forwarded-Uri",
                  "Accept",
                  "Authorization",
                  "Cookie",
                ],
                authResponseHeaders: [
                  "Remote-User",
                  "Remote-Groups",
                  "Remote-Name",
                  "Remote-Email",
                ],
              },
            },
          },
          {
            ...childOpts,
            dependsOn: httpRouteDeps,
          }
        );

        httpRouteDeps.push(this.forwardAuthMiddleware);
      }

      // Determine TLS configuration
      const tlsIssuerName = args.tls?.clusterIssuerName || "letsencrypt-prod";
      const hasTLS = args.tls?.clusterIssuer || args.tls?.clusterIssuerName;

      // Build HTTPRoute spec
      const httpRouteSpec: any = {
        parentRefs: [
          {
            name: gatewayName,
            namespace: gatewayNamespace,
          },
        ],
        hostnames: [args.domain],
        rules: [
          {
            matches: [
              {
                path: {
                  type: "PathPrefix",
                  value: "/",
                },
              },
            ],
            backendRefs: [
              {
                name: this.service.metadata.name,
                port: 80,
              },
            ],
          },
        ],
      };

      // Add ForwardAuth middleware for Authelia authentication
      if (args.auth === AuthType.FORWARD && this.forwardAuthMiddleware) {
        httpRouteSpec.rules[0].filters = [
          {
            type: "RequestHeaderModifier",
            requestHeaderModifier: {
              set: [
                {
                  name: "X-Original-URL",
                  value: `https://${args.domain}`,
                },
                {
                  name: "X-Original-Method",
                  value: "GET",
                },
              ],
            },
          },
          {
            type: "ExtensionRef",
            extensionRef: {
              group: "traefik.io",
              kind: "Middleware",
              name: this.forwardAuthMiddleware.metadata.name,
            },
          },
        ];
      }

      // Create Gateway API HTTPRoute
      this.route = new k8s.apiextensions.CustomResource(
        `${name}-httproute`,
        {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "HTTPRoute",
          metadata: {
            name: name,
            namespace: namespace.metadata.name,
            annotations: hasTLS
              ? {
                  "cert-manager.io/cluster-issuer": tlsIssuerName,
                }
              : {},
          },
          spec: httpRouteSpec,
        },
        {
          ...childOpts,
          dependsOn: httpRouteDeps,
        }
      );
    }

    // Optional: Create Cloudflare DNS record
    if (args.cloudflare) {
      this.dnsRecord = new cloudflare.Record(
        `${name}-dns`,
        {
          zoneId: args.cloudflare.zoneId,
          name: args.domain,
          type: "CNAME",
          content: args.cloudflare.tunnelCname,
          // Proxy through Cloudflare to enable both IPv4 and IPv6
          proxied: true,
          comment: `Managed by Pulumi - ${name}`,
        },
        childOpts
      );
    }

    this.registerOutputs({
      deploymentName: this.deployment.metadata.name,
      serviceName: this.service.metadata.name,
      routeName: Array.isArray(this.route)
        ? this.route.map((r) => r.metadata.name)
        : this.route.metadata.name,
      forwardAuthMiddlewareName: this.forwardAuthMiddleware?.metadata.name,
      domain: args.domain,
      dnsRecordId: this.dnsRecord?.id,
    });
  }
}
