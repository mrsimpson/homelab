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

/**
 * Helper: Waits for the external-secrets webhook to be ready.
 *
 * The webhook pod must be running and serving requests before we can create
 * resources that require webhook validation (ExternalSecrets, SecretStores).
 *
 * This works by getting the webhook Deployment resource from the Helm chart
 * and ensuring it exists (which means the Helm deployment succeeded).
 * Since the Helm chart includes the webhook pod definition with readiness probes,
 * getting the Deployment implicitly waits for it to be deployed.
 */
export function ensureWebhookReady(): pulumi.Output<any> {
  // Get the webhook deployment from the Helm chart to ensure it's deployed
  // This creates an implicit dependency on the webhook pod being ready
  return externalSecretsOperator.getResource(
    "apps/v1/Deployment",
    "external-secrets",
    "external-secrets-webhook"
  ) as pulumi.Output<any>;
}

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
