import * as k8s from "@pulumi/kubernetes";

/**
 * ingress-nginx - Ingress controller for HTTP(S) routing
 *
 * Provides:
 * - HTTP(S) routing based on hostnames
 * - TLS termination
 * - Load balancing across pods
 */

// Create namespace for ingress-nginx
// Note: Using "privileged" because ingress-nginx requires hostNetwork and hostPort
// This is necessary for k3s which doesn't have a LoadBalancer service
export const ingressNginxNamespace = new k8s.core.v1.Namespace("ingress-nginx-ns", {
  metadata: {
    name: "ingress-nginx",
    labels: {
      name: "ingress-nginx",
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/audit": "baseline",
      "pod-security.kubernetes.io/warn": "baseline",
    },
  },
});

// Use explicit namespace string with explicit dependsOn to ensure namespace is created first
export const ingressNginx = new k8s.helm.v3.Release(
  "ingress-nginx",
  {
    chart: "ingress-nginx",
    version: "4.9.0",
    namespace: "ingress-nginx", // Use string directly, dependsOn ensures it exists
    repositoryOpts: {
      repo: "https://kubernetes.github.io/ingress-nginx",
    },
    values: {
      controller: {
        // Use hostNetwork since k3s doesn't have LoadBalancer by default
        hostNetwork: true,
        // When using hostNetwork, we need ClusterFirstWithHostNet to properly resolve cluster DNS
        // This allows the pod to resolve internal service FQDNs like authelia.authelia.svc.cluster.local
        dnsPolicy: "ClusterFirstWithHostNet",
        hostPort: {
          enabled: true,
          ports: {
            http: 80,
            https: 443,
          },
        },
        service: {
          type: "ClusterIP", // Not LoadBalancer (we're on bare metal)
        },
        // Set ingressClass as default
        ingressClassResource: {
          default: true,
        },
        // CRITICAL: Use Recreate strategy instead of RollingUpdate
        // Reason: hostPort (80, 443) binding prevents multiple replicas on same node
        // RollingUpdate tries to create new pod before deleting old one, causing port conflicts
        // Recreate deletes old pod first, then creates new one (acceptable for single-node homelab)
        strategy: {
          type: "Recreate",
        },
        // Configuration for all ingresses
        config: {
          // Trust X-Forwarded-* headers from Cloudflare tunnel and reverse proxies
          // This tells nginx that the X-Forwarded-Proto, X-Forwarded-For, X-Forwarded-Host headers
          // from Cloudflare tunnel are trustworthy and should be used for backend communication
          "use-forwarded-headers": "true",
          "compute-full-forwarded-for": "true",
          "use-proxy-protocol": "false",
          // Enable configuration snippets for ingress annotations
          // Required to pass correct X-Forwarded-Proto to auth endpoints
          "allow-snippet-annotations": "true",
        },
      },
      // Webhook configuration - use failurePolicy: Ignore to prevent validation
      // webhook from blocking Ingress creation before the webhook service is ready
      admissionWebhooks: {
        failurePolicy: "Ignore",
      },
    },
  },
  {
    dependsOn: [ingressNginxNamespace], // CRITICAL: Explicit dependency on namespace resource
  }
);

export const ingressClass = "nginx";
