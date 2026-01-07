import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * ExposedWebApp - Reusable component for deploying web applications with secure internet exposure
 *
 * This component is infrastructure-agnostic and can be used with or without:
 * - Cert-manager for automatic TLS certificates
 * - Cloudflare for DNS and tunnel routing
 * - External Secrets Operator for OAuth secret management
 *
 * Automatically configures:
 * - Kubernetes Deployment
 * - Optional OAuth2 Proxy sidecar for authentication
 * - Kubernetes Service (ClusterIP)
 * - Ingress with optional TLS
 * - Optional Cloudflare DNS record
 * - Optional persistent storage
 *
 * Example (with infrastructure dependencies):
 *   new ExposedWebApp("blog", {
 *     image: "ghost:5",
 *     domain: "blog.example.com",
 *     port: 2368,
 *     cloudflare: {
 *       zoneId: "abc123",
 *       tunnelCname: "tunnel.example.com"
 *     },
 *     tls: {
 *       clusterIssuer: letsEncryptIssuer
 *     },
 *     ingress: {
 *       controller: ingressNginx
 *     }
 *   });
 *
 * Example (with private container registry):
 *   new ExposedWebApp("blog", {
 *     image: "ghcr.io/username/my-app:latest",
 *     domain: "blog.example.com",
 *     port: 2368,
 *     imagePullSecrets: [{ name: "ghcr-pull-secret" }]
 *   });
 *
 * Example (standalone):
 *   new ExposedWebApp("blog", {
 *     image: "ghost:5",
 *     domain: "blog.example.com",
 *     port: 2368
 *   });
 */

export interface OAuthConfig {
  provider: "google" | "github" | "oidc";
  clientId: string;
  clientSecret: pulumi.Output<string>;
  allowedEmails?: string[];
  oidcIssuerUrl?: string;
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

export interface IngressConfig {
  /** Ingress controller resource to depend on */
  controller?: pulumi.Resource;
  /** Ingress class name (defaults to "nginx") */
  className?: string;
}

export interface ExternalSecretsConfig {
  /** External Secrets Operator resource to depend on */
  operator?: pulumi.Resource;
  /** ClusterSecretStore name (defaults to "pulumi-esc") */
  storeName?: string;
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
  /** Environment variables */
  env?: Array<{ name: string; value: string | pulumi.Output<string> }>;
  /** OAuth2 Proxy configuration */
  oauth?: OAuthConfig;
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
  };

  // Infrastructure dependencies (all optional)
  /** Cloudflare DNS configuration */
  cloudflare?: CloudflareConfig;
  /** TLS/cert-manager configuration */
  tls?: TLSConfig;
  /** Ingress controller configuration */
  ingress?: IngressConfig;
  /** External Secrets Operator configuration */
  externalSecrets?: ExternalSecretsConfig;
}

export class ExposedWebApp extends pulumi.ComponentResource {
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  public readonly ingress: k8s.networking.v1.Ingress;
  public readonly dnsRecord?: cloudflare.Record;
  public readonly pvc?: k8s.core.v1.PersistentVolumeClaim;

  constructor(name: string, args: ExposedWebAppArgs, opts?: pulumi.ComponentResourceOptions) {
    super("homelab:ExposedWebApp", name, {}, opts);

    const childOpts = { parent: this };

    // Create namespace for the app
    const namespace = new k8s.core.v1.Namespace(
      `${name}-ns`,
      {
        metadata: {
          name: name,
          labels: {
            app: name,
            environment: pulumi.getStack(),
            // Pod Security Standards enforcement (restricted)
            "pod-security.kubernetes.io/enforce": "restricted",
            "pod-security.kubernetes.io/audit": "restricted",
            "pod-security.kubernetes.io/warn": "restricted",
          },
        },
      },
      childOpts
    );

    // Create GHCR pull secret if imagePullSecrets are specified
    // This allows the app to pull private images from GitHub Container Registry
    if (
      args.imagePullSecrets &&
      args.imagePullSecrets.length > 0 &&
      args.externalSecrets?.operator
    ) {
      // Create ExternalSecret that syncs GHCR credentials from Pulumi ESC
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
              name: args.externalSecrets.storeName || "pulumi-esc",
              kind: "ClusterSecretStore",
            },
            target: {
              name: "ghcr-pull-secret",
              creationPolicy: "Owner",
              template: {
                type: "kubernetes.io/dockerconfigjson",
                data: {
                  ".dockerconfigjson":
                    '{"auths":{"ghcr.io":{"username":"{{ .github_username }}","password":"{{ .github_token }}","auth":"{{ printf "%s:%s" .github_username .github_token | b64enc }}"}}}',
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
        { ...childOpts, dependsOn: [namespace, args.externalSecrets.operator] }
      );
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

    // Optional: Create OAuth2 Proxy configuration
    let oauthSecretName: pulumi.Output<string> | undefined;
    if (args.oauth) {
      const oauthDeps: pulumi.Resource[] = [namespace];
      if (args.externalSecrets?.operator) {
        oauthDeps.push(args.externalSecrets.operator);
      }

      // Use External Secrets if operator is provided, otherwise create a regular secret
      if (args.externalSecrets?.operator) {
        const oauthExternalSecret = new k8s.apiextensions.CustomResource(
          `${name}-oauth`,
          {
            apiVersion: "external-secrets.io/v1beta1",
            kind: "ExternalSecret",
            metadata: {
              name: `${name}-oauth`,
              namespace: namespace.metadata.name,
            },
            spec: {
              refreshInterval: "1h",
              secretStoreRef: {
                name: args.externalSecrets.storeName || "pulumi-esc",
                kind: "ClusterSecretStore",
              },
              target: {
                name: `${name}-oauth`,
                creationPolicy: "Owner",
              },
              data: [
                {
                  secretKey: "clientId",
                  remoteRef: {
                    key: `${name}/oauth/clientId`,
                  },
                },
                {
                  secretKey: "clientSecret",
                  remoteRef: {
                    key: `${name}/oauth/clientSecret`,
                  },
                },
                {
                  secretKey: "cookieSecret",
                  remoteRef: {
                    key: `${name}/oauth/cookieSecret`,
                  },
                },
              ],
            },
          },
          { ...childOpts, dependsOn: oauthDeps }
        );

        oauthSecretName = oauthExternalSecret.metadata.name;
      } else {
        // Create a regular Kubernetes secret
        const oauthSecret = new k8s.core.v1.Secret(
          `${name}-oauth`,
          {
            metadata: {
              name: `${name}-oauth`,
              namespace: namespace.metadata.name,
            },
            stringData: {
              clientId: args.oauth.clientId,
              clientSecret: args.oauth.clientSecret,
              // Generate a random cookie secret
              cookieSecret: pulumi
                .all([args.oauth.clientSecret])
                .apply(() =>
                  Buffer.from(
                    Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
                  ).toString("base64")
                ),
            },
          },
          { ...childOpts, dependsOn: oauthDeps }
        );

        oauthSecretName = oauthSecret.metadata.name;
      }
    }

    // Build container list
    const containers: any[] = [];

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
        runAsNonRoot: true,
        capabilities: {
          drop: ["ALL"],
        },
        seccompProfile: {
          type: "RuntimeDefault",
        },
      },
    };

    // Add volume mount if storage configured
    if (args.storage && this.pvc) {
      appContainer.volumeMounts = [
        {
          name: "storage",
          mountPath: args.storage.mountPath,
        },
      ];
    }

    // If OAuth configured, add oauth2-proxy sidecar
    if (args.oauth && oauthSecretName) {
      const oauthProxyContainer: any = {
        name: "oauth-proxy",
        image: "quay.io/oauth2-proxy/oauth2-proxy:v7.6.0",
        ports: [
          {
            containerPort: 4180,
            name: "oauth-http",
          },
        ],
        args: [
          "--http-address=0.0.0.0:4180",
          `--upstream=http://localhost:${args.port}`,
          "--email-domain=*",
          "--cookie-secure=true",
          "--cookie-httponly=true",
          "--set-xauthrequest=true",
        ],
        env: [
          {
            name: "OAUTH2_PROXY_CLIENT_ID",
            valueFrom: {
              secretKeyRef: {
                name: oauthSecretName,
                key: "clientId",
              },
            },
          },
          {
            name: "OAUTH2_PROXY_CLIENT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: oauthSecretName,
                key: "clientSecret",
              },
            },
          },
          {
            name: "OAUTH2_PROXY_COOKIE_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: oauthSecretName,
                key: "cookieSecret",
              },
            },
          },
        ],
        resources: {
          requests: { cpu: "10m", memory: "32Mi" },
          limits: { cpu: "100m", memory: "128Mi" },
        },
      };

      // Provider-specific configuration
      if (args.oauth.provider === "google") {
        oauthProxyContainer.args.push("--provider=google");
      } else if (args.oauth.provider === "github") {
        oauthProxyContainer.args.push("--provider=github");
      } else if (args.oauth.provider === "oidc" && args.oauth.oidcIssuerUrl) {
        oauthProxyContainer.args.push("--provider=oidc");
        oauthProxyContainer.args.push(`--oidc-issuer-url=${args.oauth.oidcIssuerUrl}`);
      }

      // Email allowlist
      if (args.oauth.allowedEmails) {
        oauthProxyContainer.args.push(`--authenticated-emails-file=/dev/null`);
        args.oauth.allowedEmails.forEach((email) => {
          oauthProxyContainer.args.push(`--email-domain=${email.split("@")[1]}`);
        });
      }

      containers.push(oauthProxyContainer);
    }

    containers.push(appContainer);

    // Build volumes list
    const volumes: any[] = [];
    if (args.storage && this.pvc) {
      volumes.push({
        name: "storage",
        persistentVolumeClaim: {
          claimName: this.pvc.metadata.name,
        },
      });
    }

    // Build Deployment dependencies
    // If imagePullSecrets are specified, the pod may depend on those secrets existing.
    // However, ExternalSecrets may take time to sync, so we add a small wait by depending
    // on the external-secrets operator if it's available.
    const deploymentDeps: pulumi.Resource[] = [namespace];
    if (
      args.externalSecrets?.operator &&
      args.imagePullSecrets &&
      args.imagePullSecrets.length > 0
    ) {
      // If using external secrets and image pull secrets, ensure the operator is ready
      deploymentDeps.push(args.externalSecrets.operator);
    }

    // Create Deployment
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
              securityContext: {
                runAsNonRoot: true,
                runAsUser: args.securityContext?.runAsUser || 1000,
                runAsGroup: args.securityContext?.runAsGroup || 1000,
                fsGroup: args.securityContext?.fsGroup || 1000,
              },
              containers: containers,
              volumes: volumes.length > 0 ? volumes : undefined,
            },
          },
        },
      },
      { ...childOpts, dependsOn: deploymentDeps }
    );

    // Determine service target port (OAuth proxy if enabled, else app port)
    const servicePort = args.oauth ? 4180 : args.port;

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
              targetPort: servicePort,
              protocol: "TCP",
              name: "http",
            },
          ],
        },
      },
      { ...childOpts, dependsOn: [this.deployment] }
    );

    // Build ingress dependencies
    const ingressDeps: pulumi.Resource[] = [this.service];
    if (args.ingress?.controller) {
      ingressDeps.push(args.ingress.controller);
    }
    if (args.tls?.clusterIssuer) {
      ingressDeps.push(args.tls.clusterIssuer);
    }

    // Determine TLS configuration
    const tlsIssuerName = args.tls?.clusterIssuerName || "letsencrypt-prod";
    const hasTLS = args.tls?.clusterIssuer || args.tls?.clusterIssuerName;

    // Build ingress annotations
    const ingressAnnotations: Record<string, pulumi.Input<string>> = {};
    if (hasTLS) {
      ingressAnnotations["cert-manager.io/cluster-issuer"] = tlsIssuerName;
    }

    // SSL redirect handling
    if (args.cloudflare) {
      // When using Cloudflare Tunnel, disable SSL redirect
      // Cloudflare handles TLS termination and connects to ingress via HTTP
      ingressAnnotations["nginx.ingress.kubernetes.io/ssl-redirect"] = "false";
    } else if (hasTLS) {
      // Enable SSL redirect when TLS is configured but NOT using Cloudflare
      ingressAnnotations["nginx.ingress.kubernetes.io/ssl-redirect"] = "true";
    }

    // Create Ingress
    this.ingress = new k8s.networking.v1.Ingress(
      `${name}-ingress`,
      {
        metadata: {
          name: name,
          namespace: namespace.metadata.name,
          annotations: ingressAnnotations,
        },
        spec: {
          ingressClassName: args.ingress?.className || "nginx",
          tls: hasTLS
            ? [
                {
                  hosts: [args.domain],
                  secretName: `${name}-tls`,
                },
              ]
            : undefined,
          rules: [
            {
              host: args.domain,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                      service: {
                        name: this.service.metadata.name,
                        port: {
                          number: 80,
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
        ...childOpts,
        dependsOn: ingressDeps,
      }
    );

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
      ingressName: this.ingress.metadata.name,
      domain: args.domain,
      dnsRecordId: this.dnsRecord?.id,
    });
  }
}
