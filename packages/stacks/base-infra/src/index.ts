/**
 * @mrsimpson/homelab-base-infra
 *
 * Base Infrastructure Stack - Orchestrates all core infrastructure modules
 *
 * This stack sets up:
 * - Cloudflare Tunnel for secure internet exposure
 * - cert-manager for automatic TLS certificates
 * - ingress-nginx for HTTP(S) routing
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
  // Auto-discover monorepo apps and create namespaces first
  // This reads the packages/apps directory to find all monorepo apps
  const fs = require("node:fs");
  const path = require("node:path");
  const appsDir = path.join(__dirname, "../../../apps");

  let appDirs: string[] = [];
  const appNamespaces: Record<string, k8s.core.v1.Namespace> = {};

  try {
    if (fs.existsSync(appsDir)) {
      appDirs = fs
        .readdirSync(appsDir, { withFileTypes: true })
        .filter((dirent: any) => dirent.isDirectory())
        .map((dirent: any) => dirent.name);

      pulumi.log.info(`Auto-discovered apps: ${appDirs.join(", ")}`);

      // Create namespaces early for all discovered apps
      // This ensures namespaces exist before GHCR pull secrets are created
      for (const appName of appDirs) {
        appNamespaces[appName] = new k8s.core.v1.Namespace(`${appName}-ns-early`, {
          metadata: {
            name: appName,
            labels: {
              app: appName,
              "managed-by": "base-infra",
              environment: pulumi.getStack(),
              // Pod Security Standards enforcement (restricted)
              "pod-security.kubernetes.io/enforce": "restricted",
              "pod-security.kubernetes.io/audit": "restricted",
              "pod-security.kubernetes.io/warn": "restricted",
            },
          },
        });
      }
    }
  } catch (error) {
    pulumi.log.warn(`Could not read apps directory: ${error}`);
  }

  // Ensure all core infrastructure namespaces are created before proceeding.
  // Depend on the NAMESPACE RESOURCES (not Helm charts) to ensure they exist
  // before any resources try to deploy into them.
  // This prevents "namespace not found" errors during deployment.
  // Note: Longhorn Helm release is explicitly exported from src/index.ts to ensure
  // it's included in the deployment dependency graph
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
        coreInfra.ingressNginxNamespace,
        coreInfra.externalSecretsNamespace,
        coreInfra.cloudflaredNamespace,
        coreInfra.longhornNamespaceResource,
      ],
    }
  );

  // Create HomelavContext for dependency injection
  const homelabContext = new HomelabContext({
    cloudflare: {
      zoneId: baseInfraConfig.cloudflare.zoneId,
      tunnelCname: coreInfra.tunnelCname,
    },
    tls: {
      clusterIssuer: coreInfra.letsEncryptIssuer,
      clusterIssuerName: coreInfra.clusterIssuerName,
    },
    ingress: {
      controller: coreInfra.ingressNginx,
    },
    externalSecrets: {
      operator: coreInfra.externalSecretsOperator,
    },
    namespaces: appNamespaces,
  });

  // Create GHCR pull secret for private container images
  // This creates ImagePullSecrets in all discovered monorepo app namespaces + default
  // External apps can create their own using createGhcrImagePullSecret() helper
  //
  // IMPORTANT: We ensure the external-secrets webhook is ready before trying to create
  // ExternalSecret resources. This prevents "no endpoints available for service" errors
  // during webhook validation.
  //
  // SETUP REQUIRED: GitHub credentials must be configured in your stack config:
  // 1. Create a GitHub Personal Access Token with read:packages scope
  // 2. Set it in your Pulumi stack:
  //    pulumi config set --secret homelab:githubToken "ghp_xxxx"
  //    pulumi config set homelab:githubUsername "your-username"
  // 3. Or update your Pulumi ESC environment with:
  //    values:
  //      github-username: your-username
  //      github-token: your-token  # Mark as secret
  //
  // To verify the secret was synced:
  //   kubectl get externalsecret ghcr-pull-secret -n <namespace>
  //   kubectl describe externalsecret ghcr-pull-secret -n <namespace>
  const monorepoAppNamespaces = ["default", ...appDirs];
  const ghcrPullSecret = coreInfra.createGhcrPullSecret(
    {
      externalSecretsOperator: coreInfra.externalSecretsOperator,
      namespaces: monorepoAppNamespaces,
    },
    {
      dependsOn: [
        ...Object.values(appNamespaces),
        coreInfra.ensureWebhookReady(), // Ensures webhook pod is ready
      ],
    }
  );

  // Log GHCR setup instructions
  pulumi.log.info(`GHCR Pull Secret: Created in namespaces [${monorepoAppNamespaces.join(", ")}]`);
  pulumi.log.info(`To verify setup, run: kubectl get externalsecret ghcr-pull-secret -A`);
  pulumi.log.info(`If secrets are pending, check config: pulumi config get homelab:githubToken`);

  // Export infrastructure details
  return {
    context: homelabContext,
    // Core infrastructure namespaces - explicitly exported so Pulumi deploys them
    namespaces: {
      certManager: coreInfra.certManagerNamespace,
      ingressNginx: coreInfra.ingressNginxNamespace,
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
    ingress: {
      ingressNginx: coreInfra.ingressNginx,
    },
    externalSecrets: {
      externalSecretsOperator: coreInfra.externalSecretsOperator,
    },
    registrySecrets: {
      ghcrPullSecret: ghcrPullSecret,
    },
  };
}
