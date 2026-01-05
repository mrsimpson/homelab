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
 * - Authelia for centralized authentication
 *
 * Exports the infrastructure context that can be used by applications.
 */

import { HomelabContext } from "@mrsimpson/homelab-core-components";
import * as coreInfra from "@mrsimpson/homelab-core-infrastructure";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { baseInfraConfig } from "./config";

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
  // Deploy Authelia for centralized authentication
  const authelia = coreInfra.createAuthelia({
    domain: pulumi.interpolate`auth.${baseInfraConfig.domain}`,
    cloudflare: {
      zoneId: baseInfraConfig.cloudflare.zoneId,
      tunnelCname: coreInfra.tunnelCname,
    },
    dependencies: {
      ingressController: coreInfra.ingressNginx,
      externalSecretsOperator: coreInfra.externalSecretsOperator,
    },
    storage: {
      storageClass: "longhorn-persistent",
      size: "1Gi", // Sufficient for <20 users
    },
  });

  // Create ingress for Authelia portal
  const autheliaIngress = new k8s.networking.v1.Ingress(
    "authelia-ingress",
    {
      metadata: {
        name: "authelia",
        namespace: authelia.namespace.metadata.name,
        annotations: {
          "cert-manager.io/cluster-issuer": coreInfra.clusterIssuerName || "letsencrypt-prod",
          "nginx.ingress.kubernetes.io/ssl-redirect": "false", // Cloudflare Tunnel handles TLS
        },
      },
      spec: {
        ingressClassName: "nginx",
        tls: [
          {
            hosts: [pulumi.interpolate`auth.${baseInfraConfig.domain}`],
            secretName: "authelia-tls",
          },
        ],
        rules: [
          {
            host: pulumi.interpolate`auth.${baseInfraConfig.domain}`,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: authelia.service.metadata.name,
                      port: { number: 80 },
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
      dependsOn: [
        authelia.service,
        ...(authelia.dnsRecord ? [authelia.dnsRecord] : []),
        ...(coreInfra.letsEncryptIssuer ? [coreInfra.letsEncryptIssuer] : []),
      ],
    }
  );

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

  // Create GHCR pull secret for private container images
  // This creates ImagePullSecrets in all discovered monorepo app namespaces + default
  // External apps can create their own using createGhcrImagePullSecret() helper
  //
  // IMPORTANT: We pass webhookReady to ensure the external-secrets webhook is responding
  // before trying to create ExternalSecret resources. This prevents validation failures.
  const monorepoAppNamespaces = ["default", ...appDirs];
  const ghcrPullSecret = coreInfra.createGhcrPullSecret(
    {
      externalSecretsOperator: coreInfra.externalSecretsOperator,
      webhookReady: coreInfra.ensureWebhookReady(),
      namespaces: monorepoAppNamespaces,
    },
    { dependsOn: Object.values(appNamespaces) }
  );

  // Create HomelabContext for dependency injection with namespaces included
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
    forwardAuth: {
      verifyUrl: authelia.verifyUrl,
      signinUrl: authelia.signinUrl,
    },
    namespaces: appNamespaces,
  });

  // Export infrastructure details
  return {
    context: homelabContext,
    namespaces: appNamespaces, // Export created namespaces for apps to reference
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
    auth: {
      authelia: authelia,
      autheliaIngress: autheliaIngress,
      autheliaUrl: authelia.signinUrl,
    },
  };
}
