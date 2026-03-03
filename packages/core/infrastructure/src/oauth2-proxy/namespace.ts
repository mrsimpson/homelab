import * as k8s from "@pulumi/kubernetes";

/**
 * oauth2-proxy namespace - Dedicated namespace for OAuth2-Proxy infrastructure
 *
 * Provides:
 * - Isolated namespace for all OAuth2-Proxy components
 * - Proper security policies for pod isolation
 * - Support for cross-namespace Traefik middleware references
 */

export const oauth2ProxyNamespace = new k8s.core.v1.Namespace("oauth2-proxy-ns", {
  metadata: {
    name: "oauth2-proxy",
    labels: {
      name: "oauth2-proxy",
      "pod-security.kubernetes.io/enforce": "baseline",
      "pod-security.kubernetes.io/audit": "baseline",
      "pod-security.kubernetes.io/warn": "baseline",
    },
  },
});

export const namespaceName = "oauth2-proxy";
