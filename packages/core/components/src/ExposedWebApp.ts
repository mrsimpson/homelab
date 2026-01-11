import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * ExposedWebApp - Reusable component for deploying web applications with secure internet exposure
 *
 * This component is infrastructure-agnostic and can be used with or without:
 * - Cert-manager for automatic TLS certificates
 * - Cloudflare for DNS and tunnel routing
 * - Authelia for centralized authentication
 *
 * Automatically configures:
 * - Kubernetes Deployment
 * - Kubernetes Service (ClusterIP)
 * - Ingress with optional TLS and forward authentication
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
 *     imagePullSecrets: [{ name: "ghcr-pull-secret" }],
 *     externalSecrets: {
 *       operator: externalSecretsOperator
 *     }
 *   });
 *   // Note: If creating a new namespace, ExternalSecret for known pull secrets
 *   // (ghcr-pull-secret, dockerhub-pull-secret) will be auto-created
 *
 * Example (standalone):
 *   new ExposedWebApp("blog", {
 *     image: "ghost:5",
 *     domain: "blog.example.com",
 *     port: 2368
 *   });
 */

/**
 * Authentication type for ExposedWebApp
 */
export enum AuthType {
  /** No authentication required */
  NONE = "none",
  /** Authelia forward authentication via nginx annotations */
  FORWARD = "forward",
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

export interface ForwardAuthConfig {
  /** Authelia verify URL for forward authentication */
  verifyUrl: string | pulumi.Output<string>;
  /** Authelia signin URL for redirects */
  signinUrl: string | pulumi.Output<string>;
  /** Response headers to forward from Authelia (defaults to Remote-User,Remote-Email,Remote-Groups) */
  responseHeaders?: string;
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
  };
  /** Optional pre-created namespace (if not provided, will create one) */
  namespace?: k8s.core.v1.Namespace;

  // Infrastructure dependencies (all optional)
  /** Cloudflare DNS configuration */
  cloudflare?: CloudflareConfig;
  /** TLS/cert-manager configuration */
  tls?: TLSConfig;
  /** Ingress controller configuration */
  ingress?: IngressConfig;
  /** External Secrets Operator configuration */
  externalSecrets?: ExternalSecretsConfig;
  /** Forward authentication configuration (Authelia) */
  forwardAuth?: ForwardAuthConfig;
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

    // Use provided namespace or create a new one
    const isCreatingNamespace = !args.namespace;
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
              // Pod Security Standards enforcement (restricted)
              "pod-security.kubernetes.io/enforce": "restricted",
              "pod-security.kubernetes.io/audit": "restricted",
              "pod-security.kubernetes.io/warn": "restricted",
            },
          },
        },
        childOpts
      );

    // If creating a new namespace AND imagePullSecrets are specified,
    // automatically create ExternalSecrets for common pull secret names
    // This ensures private images can be pulled without manual secret creation
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
              securityContext: {
                runAsNonRoot: true,
                runAsUser: args.securityContext?.runAsUser || 1000,
                runAsGroup: args.securityContext?.runAsGroup || 1000,
                fsGroup: args.securityContext?.fsGroup || 1000,
              },
              containers: [appContainer],
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

    // Forward authentication (Authelia) - Using official v4.38.0 method
    if (args.auth === AuthType.FORWARD) {
      // Use the correct v4.38.0 authz endpoint (not legacy /api/verify)
      ingressAnnotations["nginx.ingress.kubernetes.io/auth-method"] = "GET";
      ingressAnnotations["nginx.ingress.kubernetes.io/auth-url"] =
        "http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request";
      ingressAnnotations["nginx.ingress.kubernetes.io/auth-signin"] =
        "https://auth.no-panic.org?rm=$request_method&rd=$scheme://$http_host$request_uri";
      ingressAnnotations["nginx.ingress.kubernetes.io/auth-response-headers"] =
        "Remote-User,Remote-Name,Remote-Groups,Remote-Email";
    }

    // Forward headers from proxy (Cloudflare, ingress controller)
    // This allows backends to know the real client IP, protocol (HTTPS), and host
    // Critical for Authelia to know requests are HTTPS and to generate correct redirect URLs
    if (args.cloudflare || args.auth === AuthType.FORWARD) {
      ingressAnnotations["nginx.ingress.kubernetes.io/use-forwarded-headers"] = "true";
      ingressAnnotations["nginx.ingress.kubernetes.io/compute-full-forwarded-for"] = "true";
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
