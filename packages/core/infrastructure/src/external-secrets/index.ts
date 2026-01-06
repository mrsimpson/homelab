import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * External Secrets Operator - Syncs secrets from external backends to Kubernetes
 *
 * Supports multiple backends:
 * - Pulumi ESC (initial implementation)
 * - HashiCorp Vault (for dynamic secrets)
 * - AWS Secrets Manager (for rotation)
 * - GCP Secret Manager
 * - And 40+ more backends
 *
 * See ADR 008 for architecture decisions and migration path.
 */

const config = new pulumi.Config();

// Create namespace for External Secrets Operator
const namespace = new k8s.core.v1.Namespace("external-secrets", {
  metadata: {
    name: "external-secrets",
    labels: {
      name: "external-secrets",
      "pod-security.kubernetes.io/enforce": "restricted",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    },
  },
});

// Deploy External Secrets Operator via Helm
// CRITICAL FIX: Set webhook.failurePolicy to "Ignore" to prevent race condition
// where ExternalSecret resources are validated before webhook pods are ready.
// This allows resources to be created even if the webhook isn't responding yet,
// preventing the "service not found" errors during cluster initialization.
export const externalSecretsOperator = new k8s.helm.v3.Chart(
  "external-secrets",
  {
    chart: "external-secrets",
    version: "0.11.0",
    namespace: namespace.metadata.name,
    fetchOpts: {
      repo: "https://charts.external-secrets.io",
    },
    values: {
      installCRDs: true,
      webhook: {
        port: 9443,
        // Use failurePolicy: Ignore to prevent blocking resource creation
        // when webhook pods aren't ready yet. This solves the race condition
        // where ExternalSecret resources are created before the webhook service
        // is available for validation.
        // See: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/#failure-policy
        failurePolicy: "Ignore",
      },
      // Resource limits for operator pods
      resources: {
        requests: {
          cpu: "50m",
          memory: "64Mi",
        },
        limits: {
          cpu: "200m",
          memory: "256Mi",
        },
      },
      // Security context
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        fsGroup: 1000,
      },
    },
  },
  { dependsOn: [namespace] }
);

// Create Pulumi API token secret for ESO to access Pulumi ESC
// This token allows ESO to read secrets from Pulumi Cloud/ESC
const pulumiApiTokenSecret = new k8s.core.v1.Secret(
  "pulumi-api-token",
  {
    metadata: {
      name: "pulumi-api-token",
      namespace: namespace.metadata.name,
    },
    stringData: {
      token: config.requireSecret("pulumiAccessToken"),
    },
  },
  { dependsOn: [namespace] }
);

// Configure Pulumi ESC as a ClusterSecretStore backend
// This allows all namespaces to pull secrets from Pulumi ESC
export const pulumiEscStore = new k8s.apiextensions.CustomResource(
  "pulumi-esc-store",
  {
    apiVersion: "external-secrets.io/v1beta1",
    kind: "ClusterSecretStore",
    metadata: {
      name: "pulumi-esc",
    },
    spec: {
      provider: {
        pulumi: {
          organization: config.require("pulumiOrganization"),
          project: pulumi.getProject(),
          environment: pulumi.getStack(),
          accessToken: {
            secretRef: {
              name: pulumiApiTokenSecret.metadata.name,
              namespace: pulumiApiTokenSecret.metadata.namespace,
              key: "token",
            },
          },
        },
      },
    },
  },
  { dependsOn: [externalSecretsOperator, pulumiApiTokenSecret] }
);

// Export status for verification
export const externalSecretsNamespace = namespace.metadata.name;

// Future: Vault ClusterSecretStore (commented out for now)
/*
export const vaultStore = new k8s.apiextensions.CustomResource(
  "vault-store",
  {
    apiVersion: "external-secrets.io/v1beta1",
    kind: "ClusterSecretStore",
    metadata: {
      name: "vault-backend",
    },
    spec: {
      provider: {
        vault: {
          server: "http://vault.vault.svc:8200",
          path: "secret",
          version: "v2",
          auth: {
            kubernetes: {
              mountPath: "kubernetes",
              role: "external-secrets",
            },
          },
        },
      },
    },
  },
  { dependsOn: [externalSecretsOperator] }
);
*/

// Future: AWS Secrets Manager ClusterSecretStore (commented out for now)
/*
export const awsSecretsManagerStore = new k8s.apiextensions.CustomResource(
  "aws-secrets-manager-store",
  {
    apiVersion: "external-secrets.io/v1beta1",
    kind: "ClusterSecretStore",
    metadata: {
      name: "aws-sm",
    },
    spec: {
      provider: {
        aws: {
          service: "SecretsManager",
          region: config.require("awsRegion"),
          auth: {
            jwt: {
              serviceAccountRef: {
                name: "external-secrets-sa",
              },
            },
          },
        },
      },
    },
  },
  { dependsOn: [externalSecretsOperator] }
);
*/
