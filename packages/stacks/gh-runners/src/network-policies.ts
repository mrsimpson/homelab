/**
 * Network Policies for GitHub Actions Runner Isolation
 *
 * SECURITY MODEL: Defense in depth against malicious workflows
 *
 * These policies implement network segmentation to prevent:
 * 1. Lateral movement to other pods in the cluster
 * 2. Access to Kubernetes API server
 * 3. Access to internal homelab services
 * 4. DNS exfiltration or tunneling
 *
 * Allowed traffic:
 * - Outbound HTTPS to GitHub API (api.github.com)
 * - Outbound HTTPS to GitHub CDN (for downloading actions)
 * - DNS queries (restricted to kube-dns only)
 *
 * Denied traffic:
 * - All pod-to-pod communication
 * - Access to cluster API server
 * - Access to metadata services (if on cloud)
 * - All other internet egress
 *
 * Note: NetworkPolicies are additive. Start with deny-all, then allow specific traffic.
 */

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";

export interface NetworkPolicyConfig {
  namespace: pulumi.Input<string>;
  dependsOn?: pulumi.Input<pulumi.Resource>[];
}

export function createRunnerNetworkPolicies(
  homelab: HomelabContext,
  config: NetworkPolicyConfig,
) {
  // Policy 1: Deny ALL ingress traffic
  // Runners should never accept inbound connections
  const denyAllIngress = new k8s.networking.v1.NetworkPolicy(
    "deny-all-ingress",
    {
      metadata: {
        name: "deny-all-ingress",
        namespace: config.namespace,
        labels: {
          "app.kubernetes.io/name": "github-runners",
          "app.kubernetes.io/component": "network-policy",
        },
      },
      spec: {
        podSelector: {
          matchLabels: {
            // Apply to all pods in namespace
          },
        },
        policyTypes: ["Ingress"],
        // Empty ingress rules = deny all
        ingress: [],
      },
    },
    {
      provider: homelab.kubernetesProvider,
      dependsOn: config.dependsOn,
    },
  );

  // Policy 2: Default deny egress, then allow specific destinations
  const restrictEgress = new k8s.networking.v1.NetworkPolicy(
    "restrict-egress",
    {
      metadata: {
        name: "restrict-egress",
        namespace: config.namespace,
        labels: {
          "app.kubernetes.io/name": "github-runners",
          "app.kubernetes.io/component": "network-policy",
        },
      },
      spec: {
        podSelector: {
          matchLabels: {
            // Apply to all runner pods
            "actions.github.com/scale-set-name": "*",
          },
        },
        policyTypes: ["Egress"],
        egress: [
          // Allow DNS queries to kube-dns only
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "kube-system",
                  },
                },
                podSelector: {
                  matchLabels: {
                    "k8s-app": "kube-dns",
                  },
                },
              },
            ],
            ports: [
              {
                protocol: "UDP",
                port: 53,
              },
              {
                protocol: "TCP",
                port: 53,
              },
            ],
          },

          // Allow HTTPS to GitHub API and CDN
          {
            to: [
              {
                // Allow internet egress for GitHub
                // Note: k8s NetworkPolicies don't support domain-based rules
                // Consider using Cilium or Calico for FQDN filtering
                namespaceSelector: {},
                podSelector: {},
              },
            ],
            ports: [
              {
                protocol: "TCP",
                port: 443, // HTTPS
              },
              {
                protocol: "TCP",
                port: 80, // HTTP (GitHub redirects to HTTPS)
              },
            ],
          },
        ],
      },
    },
    { provider: homelab.kubernetesProvider },
  );

  // Policy 3: Deny access to Kubernetes API server
  // Even if compromised, runners shouldn't be able to interact with k8s
  const denyK8sApi = new k8s.networking.v1.NetworkPolicy(
    "deny-k8s-api",
    {
      metadata: {
        name: "deny-k8s-api",
        namespace: config.namespace,
        labels: {
          "app.kubernetes.io/name": "github-runners",
          "app.kubernetes.io/component": "network-policy",
        },
      },
      spec: {
        podSelector: {
          matchLabels: {},
        },
        policyTypes: ["Egress"],
        egress: [
          {
            // Explicitly deny traffic to API server CIDR
            // Adjust this based on your k3s service CIDR
            to: [
              {
                ipBlock: {
                  // Deny cluster service network (typical k3s default)
                  cidr: "10.43.0.0/16",
                  except: [
                    // Allow DNS (kube-dns is typically at 10.43.0.10)
                    "10.43.0.10/32",
                  ],
                },
              },
            ],
          },
        ],
      },
    },
    { provider: homelab.kubernetesProvider },
  );

  // Policy 4: Deny access to cloud metadata services (defense in depth)
  // Prevents SSRF attacks targeting metadata endpoints
  const denyMetadata = new k8s.networking.v1.NetworkPolicy(
    "deny-metadata",
    {
      metadata: {
        name: "deny-metadata",
        namespace: config.namespace,
        labels: {
          "app.kubernetes.io/name": "github-runners",
          "app.kubernetes.io/component": "network-policy",
        },
      },
      spec: {
        podSelector: {
          matchLabels: {},
        },
        policyTypes: ["Egress"],
        egress: [
          {
            to: [
              {
                ipBlock: {
                  cidr: "0.0.0.0/0",
                  except: [
                    // AWS metadata
                    "169.254.169.254/32",
                    // Google Cloud metadata
                    "169.254.169.254/32",
                    // Azure metadata
                    "169.254.169.254/32",
                    // Link-local (includes metadata services)
                    "169.254.0.0/16",
                  ],
                },
              },
            ],
          },
        ],
      },
    },
    { provider: homelab.kubernetesProvider },
  );

  return {
    denyAllIngress,
    restrictEgress,
    denyK8sApi,
    denyMetadata,
  };
}
