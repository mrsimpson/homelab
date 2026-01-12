import { homelabConfig } from "@mrsimpson/homelab-config";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * cert-manager - Automatic TLS certificate management
 *
 * Provides:
 * - Automatic Let's Encrypt certificate provisioning
 * - Certificate renewal
 * - ClusterIssuer for production certificates
 * - DNS-01 challenge support for wildcard certificates
 * - DNS-01 challenge support for wildcard certificates
 *
 * WEBHOOK READINESS:
 * The cert-manager ValidatingWebhookConfiguration must be ready before creating
 * ClusterIssuer resources. Similar to external-secrets, the webhook configuration
 * is created when the Helm chart deploys, but the webhook pod needs time to start.
 * We ensure this by adding an explicit dependency on the cert-manager Helm chart.
 */

// Create namespace for cert-manager
export const certManagerNamespace = new k8s.core.v1.Namespace("cert-manager-ns", {
  metadata: {
    name: "cert-manager",
    labels: {
      name: "cert-manager",
      "pod-security.kubernetes.io/enforce": "baseline",
      "pod-security.kubernetes.io/audit": "baseline",
      "pod-security.kubernetes.io/warn": "baseline",
    },
  },
});

// Install cert-manager via Helm
// Use explicit namespace string with explicit dependsOn to ensure namespace is created first
export const certManager = new k8s.helm.v3.Release(
  "cert-manager",
  {
    chart: "cert-manager",
    version: "v1.14.0",
    namespace: "cert-manager", // Use string directly, dependsOn ensures it exists
    repositoryOpts: {
      repo: "https://charts.jetstack.io",
    },
    values: {
      installCRDs: true,
      global: {
        leaderElection: {
          namespace: "cert-manager",
        },
      },
    },
  },
  {
    dependsOn: [certManagerNamespace], // CRITICAL: Explicit dependency on namespace resource
  }
);

/**
 * Create ClusterIssuer for Let's Encrypt production
 *
 * The ClusterIssuer resource requires the cert-manager ValidatingWebhookConfiguration
 * to be ready for validation. By depending on the cert-manager Helm chart, we ensure
 * that the webhook pod has had time to start and mount its certificates.
 *
 * This replaces the previous skipClusterIssuer workaround which required manual
 * config changes on first deployment. Now it just works automatically.
 */
export const letsEncryptIssuer = new k8s.apiextensions.CustomResource(
  "letsencrypt-prod",
  {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
      name: "letsencrypt-prod",
    },
    spec: {
      acme: {
        server: "https://acme-v02.api.letsencrypt.org/directory",
        email: homelabConfig.email,
        privateKeySecretRef: {
          name: "letsencrypt-prod",
        },
        solvers: [
          {
            http01: {
              gatewayHTTPRoute: {
                parentRefs: [
                  {
                    name: "homelab-gateway",
                    namespace: "traefik-system",
                    kind: "Gateway",
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
  {
    dependsOn: [certManager],
  }
);

// Create Cloudflare API token secret for DNS-01 challenges
const cloudflareConfig = new pulumi.Config("cloudflare");
export const cloudflareApiTokenSecret = new k8s.core.v1.Secret(
  "cloudflare-api-token",
  {
    metadata: {
      name: "cloudflare-api-token",
      namespace: certManagerNamespace.metadata.name,
    },
    type: "Opaque",
    stringData: {
      "api-token": cloudflareConfig.requireSecret("apiToken"),
    },
  },
  {
    dependsOn: [certManager],
  }
);

// Create DNS-01 ClusterIssuer for wildcard certificates
export const letsEncryptDns01Issuer = new k8s.apiextensions.CustomResource(
  "letsencrypt-prod-dns01",
  {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
      name: "letsencrypt-prod-dns01",
    },
    spec: {
      acme: {
        server: "https://acme-v02.api.letsencrypt.org/directory",
        email: homelabConfig.email,
        privateKeySecretRef: {
          name: "letsencrypt-prod-dns01",
        },
        solvers: [
          {
            dns01: {
              cloudflare: {
                apiTokenSecretRef: {
                  name: cloudflareApiTokenSecret.metadata.name,
                  key: "api-token",
                },
              },
            },
            selector: {
              dnsZones: [homelabConfig.domain],
            },
          },
        ],
      },
    },
  },
  {
    dependsOn: [certManager, cloudflareApiTokenSecret],
  }
);

export const clusterIssuerName = letsEncryptIssuer.metadata.name;
export const dns01ClusterIssuerName = letsEncryptDns01Issuer.metadata.name;
