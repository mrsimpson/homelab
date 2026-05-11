/**
 * @mrsimpson/homelab-base-infra
 *
 * Orchestrates all core infrastructure operators and exports a `HomelabContext`
 * for dependency injection into app stacks.
 */

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as coreInfra from "@mrsimpson/homelab-core-infrastructure";
import { baseInfraConfig } from "./config";
import { HomelabContext } from "@mrsimpson/homelab-core-components";

// Export config for reference in other stacks
export { baseInfraConfig };

// Export Pulumi context info
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

/**
 * Sets up and exports all base infrastructure components
 *
 * Returns a context object that can be used by applications to create
 * ExposedWebApp instances with infrastructure dependencies injected.
 */
export function setupBaseInfra() {
  // All namespaces must exist before any Helm charts deploy into them.
  // The ConfigMap acts as a synchronisation point — app stacks depend on it
  // via infrastructureReady rather than tracking individual operators.
  const infrastructureReady = new k8s.core.v1.ConfigMap(
    "base-infra-ready",
    {
      metadata: {
        name: "base-infra-ready",
        namespace: "kube-system",
      },
      data: {
        ready: "true",
      },
    },
    {
      dependsOn: [
        coreInfra.certManagerNamespace,
        coreInfra.traefikNamespace,
        coreInfra.externalSecretsNamespace,
        coreInfra.cloudflaredNamespace,
        coreInfra.longhornNamespaceResource,
        coreInfra.cnpgNamespace,
        coreInfra.pulumiEscStore, // ClusterSecretStore must be ready
        coreInfra.letsEncryptIssuer, // ClusterIssuer must be created
        coreInfra.cnpg, // CNPG operator must be ready before Cluster CRDs can be applied
      ],
    }
  );

  // Create HomelabContext for dependency injection into apps
  const homelabContext = new HomelabContext({
    cloudflare: {
      zoneId: baseInfraConfig.cloudflare.zoneId,
      tunnelCname: coreInfra.tunnelCname,
    },
    tls: {
      clusterIssuer: coreInfra.letsEncryptIssuer,
      clusterIssuerName: coreInfra.clusterIssuerName,
    },
    gatewayApi: {
      controller: coreInfra.traefik,
      gatewayClass: "traefik",
      gatewayName: "homelab-gateway",
      gatewayNamespace: "traefik-system",
      forwardAuthMiddleware: "authelia-forwardauth",
    },
    externalSecrets: {
      operator: coreInfra.externalSecretsOperator,
    },
  });

  return {
    context: homelabContext,
    infrastructureReady,
    namespaces: {
      certManager: coreInfra.certManagerNamespace,
      traefik: coreInfra.traefikNamespace,
      externalSecrets: coreInfra.externalSecretsNamespace,
      cloudflared: coreInfra.cloudflaredNamespace,
      longhorn: coreInfra.longhornNamespaceResource,
    },
    storage: {
      longhorn: coreInfra.longhorn,
    },
    cloudflare: {
      tunnel: coreInfra.tunnel,
      tunnelCname: coreInfra.tunnelCname,
      tunnelId: coreInfra.tunnelId,
    },
    certManager: {
      letsEncryptIssuer: coreInfra.letsEncryptIssuer,
      clusterIssuerName: coreInfra.clusterIssuerName,
    },
    gateway: {
      traefik: coreInfra.traefik,
      gatewayClass: coreInfra.traefikGatewayClass,
      gateway: coreInfra.homelabGateway,
      forwardAuthMiddleware: coreInfra.autheliForwardAuth,
    },
    externalSecrets: {
      externalSecretsOperator: coreInfra.externalSecretsOperator,
      clusterSecretStore: coreInfra.pulumiEscStore,
    },
    cnpg: {
      operator: coreInfra.cnpg,
    },
  };
}
