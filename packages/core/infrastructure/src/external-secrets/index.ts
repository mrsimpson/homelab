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
 *
 * WEBHOOK READINESS REQUIREMENT:
 * The external-secrets-webhook deployment must be ready before creating resources
 * that require webhook validation (ExternalSecrets, SecretStores).
 *
 * When the External Secrets Helm chart deploys:
 * 1. ValidatingWebhookConfiguration is created immediately
 * 2. Webhook pod starts but takes time to become ready (image pull, TLS setup)
 * 3. If ExternalSecrets are created before webhook is ready, validation fails with
 *    "no endpoints available for service" error
 *
 * SOLUTION:
 * Wrap ExternalSecret creation in a resource that explicitly depends on the
 * webhook deployment being ready. This ensures Pulumi waits for the webhook
 * pod readiness check to pass before attempting to create validation resources.
 */

const config = new pulumi.Config();

// Create namespace for External Secrets Operator
export const externalSecretsNamespace = new k8s.core.v1.Namespace("external-secrets", {
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
// Use explicit namespace string with explicit dependsOn to ensure namespace is created first
export const externalSecretsOperator = new k8s.helm.v3.Release(
  "external-secrets",
  {
    chart: "external-secrets",
    version: "0.11.0",
    namespace: "external-secrets", // Use string directly, dependsOn ensures it exists
    repositoryOpts: {
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
  { dependsOn: [externalSecretsNamespace] } // CRITICAL: Explicit dependency on namespace resource
);

/**
 * Helper: Waits for the external-secrets webhook to be ready.
 *
 * The webhook pod must be running and serving requests before we can create
 * resources that require webhook validation (ExternalSecrets, SecretStores).
 *
 * This works by depending on the Helm Release itself. Since the Helm chart
 * includes the webhook pod definition with readiness probes, the Release
 * deployment ensures the webhook pod is ready before returning.
 */
export function ensureWebhookReady(): pulumi.Resource {
  // Return the external-secrets operator resource as a dependency marker
  // Anything depending on this will wait for the webhook pod to be ready
  return externalSecretsOperator;
}

// Create Pulumi API token secret for ESO to access Pulumi ESC
// This token allows ESO to read secrets from Pulumi Cloud/ESC
// Must depend on externalSecretsOperator to ensure namespace is created first
const pulumiApiTokenSecret = new k8s.core.v1.Secret(
  "pulumi-api-token",
  {
    metadata: {
      name: "pulumi-api-token",
      namespace: "external-secrets", // Use string directly, dependsOn ensures it exists
    },
    stringData: {
      token: config.requireSecret("pulumiAccessToken"),
    },
  },
  { dependsOn: [externalSecretsNamespace, externalSecretsOperator] } // CRITICAL: Explicit dependencies
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

// Note: externalSecretsNamespace is already exported as the namespace resource at the top of this file

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
  { dependsOn: [externalSecretsNamespace, externalSecretsOperator] }
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
  { dependsOn: [externalSecretsNamespace, externalSecretsOperator] }
);
*/
