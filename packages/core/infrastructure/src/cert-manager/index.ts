import { homelabConfig } from "@mrsimpson/homelab-config";
import * as k8s from "@pulumi/kubernetes";

/**
 * cert-manager - Automatic TLS certificate management
 *
 * Provides:
 * - Automatic Let's Encrypt certificate provisioning
 * - Certificate renewal
 * - ClusterIssuer for production certificates
 *
 * WEBHOOK READINESS:
 * The cert-manager ValidatingWebhookConfiguration must be ready before creating
 * ClusterIssuer resources. Similar to external-secrets, the webhook configuration
 * is created when the Helm chart deploys, but the webhook pod needs time to start.
 * We ensure this by adding an explicit dependency on the cert-manager Helm chart.
 */

// Create namespace for cert-manager
const namespace = new k8s.core.v1.Namespace("cert-manager-ns", {
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
export const certManager = new k8s.helm.v3.Chart(
  "cert-manager",
  {
    chart: "cert-manager",
    version: "v1.14.0",
    namespace: namespace.metadata.name,
    fetchOpts: {
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
    dependsOn: [namespace],
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
              ingress: {
                class: "nginx",
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

export const clusterIssuerName = letsEncryptIssuer.metadata.name;
