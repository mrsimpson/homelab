import * as k8s from "@pulumi/kubernetes";

/**
 * traefik-gateway - Gateway API-based HTTP(S) routing with Traefik
 *
 * Provides:
 * - HTTP(S) routing based on Gateway API standard
 * - ForwardAuth middleware for Authelia integration
 * - TLS termination with cert-manager integration
 * - Resolves HTTP scheme compatibility issues with Authelia v4.38.0
 */

// Create namespace for traefik-gateway
// Note: Using "privileged" because Traefik requires hostNetwork and hostPort
// This matches the ingress-nginx pattern for k3s deployment
export const traefikNamespace = new k8s.core.v1.Namespace("traefik-gateway-ns", {
  metadata: {
    name: "traefik-system",
    labels: {
      name: "traefik-system",
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/audit": "baseline",
      "pod-security.kubernetes.io/warn": "baseline",
    },
  },
});

// Install Traefik via Helm with Gateway API support
// Use explicit namespace string with explicit dependsOn to ensure namespace is created first
export const traefik = new k8s.helm.v3.Release(
  "traefik",
  {
    chart: "traefik",
    version: "32.1.0", // Latest stable with Gateway API v1.4.0 support
    namespace: "traefik-system", // Use string directly, dependsOn ensures it exists
    repositoryOpts: {
      repo: "https://traefik.github.io/charts",
    },
    values: {
      providers: {
        kubernetesGateway: {
          enabled: true,
          experimentalChannel: false, // Stable features only
        },
        kubernetesCRD: {
          enabled: true, // Keep CRD support for migration compatibility
        },
      },
      // Match k3s + hostPort pattern like ingress-nginx
      service: {
        type: "ClusterIP", // Not LoadBalancer (we're on bare metal)
        // CRITICAL: Ensure service selector works with Helm-generated labels
        // This addresses the service endpoint resolution issue from PATCHES_APPLIED.md
        annotations: {
          // Let Helm manage the service selector - it will match deployment labels automatically
          "pulumi.com/skipAwait": "true",
        },
      },
      deployment: {
        replicas: 1, // Single-node homelab
      },
      ingressClass: {
        enabled: false, // We're using Gateway API, not ingress
      },
      ports: {
        web: {
          port: 8000, // Traefik's default internal container port
          protocol: "TCP",
        },
        websecure: {
          port: 8443, // Traefik's default internal container port for TLS
          protocol: "TCP",
          tls: {
            enabled: true,
          },
        },
      },
      // Remove hostNetwork - we're using Cloudflare tunnel, not direct host exposure
      // This eliminates the hostPort/containerPort validation error
      // hostNetwork: true,
      // dnsPolicy: "ClusterFirstWithHostNet",
      // CRITICAL: Use Recreate strategy instead of RollingUpdate
      // Reason: hostPort (80, 443) binding prevents multiple replicas on same node
      // RollingUpdate tries to create new pod before deleting old one, causing port conflicts
      // Recreate deletes old pod first, then creates new one (acceptable for single-node homelab)
      updateStrategy: {
        type: "Recreate",
      },
      // Enable metrics for monitoring
      metrics: {
        prometheus: {
          enabled: true,
        },
      },
      // Global configuration
      globalArguments: ["--global.checknewversion=false", "--global.sendanonymoususage=false"],
    },
  },
  {
    dependsOn: [traefikNamespace], // CRITICAL: Explicit dependency on namespace resource
  }
);

// Note: Traefik Helm chart creates its own service automatically
// Service name follows pattern: {release-name} (e.g., traefik-abc12345)
// We'll reference this service in components that need it

// Create GatewayClass for Traefik
export const traefikGatewayClass = new k8s.apiextensions.CustomResource(
  "traefik-gatewayclass",
  {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "GatewayClass",
    metadata: {
      name: "traefik",
    },
    spec: {
      controllerName: "traefik.io/gateway-controller",
      description: "Traefik Gateway Controller for homelab infrastructure",
    },
  },
  {
    dependsOn: [traefik],
  }
);

// Create TLS Certificate for Gateway (DNS-01 challenge for wildcard only)
export const gatewayTlsCertificate = new k8s.apiextensions.CustomResource(
  "homelab-gateway-tls",
  {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
      name: "homelab-gateway-tls",
      namespace: "traefik-system",
    },
    spec: {
      secretName: "homelab-gateway-tls",
      issuerRef: {
        name: "letsencrypt-prod-dns01", // Use DNS-01 issuer for wildcard
        kind: "ClusterIssuer",
      },
      dnsNames: [
        "*.no-panic.org", // Wildcard certificate only (simpler and more reliable)
      ],
    },
  },
  {
    dependsOn: [traefik],
  }
);

// Create main Gateway for homelab
export const homelabGateway = new k8s.apiextensions.CustomResource(
  "homelab-gateway",
  {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "Gateway",
    metadata: {
      name: "homelab-gateway",
      namespace: "traefik-system",
    },
    spec: {
      gatewayClassName: "traefik",
      listeners: [
        {
          name: "web",
          port: 8000, // Match Traefik's internal container port
          protocol: "HTTP",
          allowedRoutes: {
            namespaces: {
              from: "All",
            },
          },
        },
        {
          name: "websecure",
          port: 8443, // Match Traefik's internal container port for TLS
          protocol: "HTTPS",
          allowedRoutes: {
            namespaces: {
              from: "All",
            },
          },
          tls: {
            mode: "Terminate",
            certificateRefs: [
              {
                name: "homelab-gateway-tls",
                kind: "Secret",
              },
            ],
          },
        },
      ],
    },
  },
  {
    dependsOn: [traefikGatewayClass, gatewayTlsCertificate],
  }
);

// Create ForwardAuth Middleware for Authelia integration
export const autheliForwardAuth = new k8s.apiextensions.CustomResource(
  "authelia-forwardauth",
  {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: "authelia-forwardauth",
      namespace: "traefik-system",
    },
    spec: {
      forwardAuth: {
        address: "http://authelia.authelia.svc.cluster.local:9091/api/authz/auth-request",
        trustForwardHeader: true,
        // Required headers for Authelia authentication (fixes HTTP scheme issue)
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
        authResponseHeaders: ["Remote-User", "Remote-Groups", "Remote-Name", "Remote-Email"],
      },
    },
  },
  {
    dependsOn: [traefik],
  }
);

// Export values for other components to use
export const gatewayClassName = "traefik";
export const gatewayName = "homelab-gateway";
export const gatewayNamespace = "traefik-system";
export const forwardAuthMiddlewareName = "authelia-forwardauth";
// Traefik service name follows pattern: {helm-release-name}
export const traefikServiceName = traefik.name; // Dynamic Helm release name
