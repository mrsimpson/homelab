/**
 * @mrsimpson/homelab-base-infra
 *
 * Base Infrastructure Stack - Orchestrates all core infrastructure modules
 *
 * This stack sets up:
 * - Cloudflare Tunnel for secure internet exposure
 * - cert-manager for automatic TLS certificates
 * - traefik-gateway for HTTP(S) routing via Gateway API
 * - External Secrets Operator for secret management
 *
 * Exports the infrastructure context that can be used by applications.
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
  // DEPENDENCY CHAIN FOR BASE INFRASTRUCTURE:
  // 1. Create core namespaces (cert-manager, traefik-system, external-secrets, cloudflare, longhorn)
  // 2. Deploy Helm charts in those namespaces
  // 3. Wait for external-secrets operator to be ready
  // 4. Create ClusterSecretStore to sync secrets from Pulumi ESC
  // 5. Create ClusterIssuer for TLS certificate management
  // 6. Mark base infrastructure as ready
  //
  // APP DEPENDENCY CHAIN (handled in ExposedWebApp and per-app code):
  // 1. Create app namespace (ExposedWebApp)
  // 2. Create GHCR pull secret in app namespace (ExposedWebApp, if imagePullSecrets specified)
  // 3. Create app Deployment with imagePullSecrets reference

  // Ensure all core infrastructure namespaces are created before proceeding.
  // Depend on the NAMESPACE RESOURCES (not Helm charts) to ensure they exist
  // before any resources try to deploy into them.
  // This prevents "namespace not found" errors during deployment.
  // Store as unused to satisfy dependency ordering without additional exports
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
        coreInfra.pulumiEscStore, // ClusterSecretStore must be ready
        coreInfra.letsEncryptIssuer, // ClusterIssuer must be created
      ],
    }
  );

  // Create HomelabContext for dependency injection into apps
  // Apps will use this context to access infrastructure dependencies
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

  // Export infrastructure details
  return {
    context: homelabContext,
    infrastructureReady, // Export to ensure dependency ordering
    // Core infrastructure namespaces - explicitly exported so Pulumi deploys them
    namespaces: {
      certManager: coreInfra.certManagerNamespace,
      traefik: coreInfra.traefikNamespace,
      externalSecrets: coreInfra.externalSecretsNamespace,
      cloudflared: coreInfra.cloudflaredNamespace,
      longhorn: coreInfra.longhornNamespaceResource,
    },
    storage: {
      longhorn: coreInfra.longhorn, // Export Longhorn Helm release to ensure it's deployed
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
  };
}
