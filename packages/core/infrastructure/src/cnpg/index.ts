import * as k8s from "@pulumi/kubernetes";

/**
 * CloudNativePG (CNPG) operator — manages PostgreSQL clusters via `Cluster` CRDs.
 *
 * Like cert-manager and external-secrets, CNPG installs a ValidatingWebhookConfiguration.
 * Pass `cnpg` as `cnpgOperator` to `PostgresInstance` so Cluster CRDs aren't applied
 * before the webhook pod is ready.
 */

export const cnpgNamespace = new k8s.core.v1.Namespace("cnpg-ns", {
  metadata: {
    name: "cnpg-system",
    labels: {
      name: "cnpg-system",
      "pod-security.kubernetes.io/enforce": "restricted",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    },
  },
});

export const cnpg = new k8s.helm.v3.Release(
  "cnpg",
  {
    // Explicit release name keeps Helm ownership annotations on CRDs stable across
    // Pulumi runs. A hash-based name would break "invalid ownership metadata" checks
    // on the CRDs if the release is ever re-created.
    name: "cnpg",
    chart: "cloudnative-pg",
    version: "0.28.0", // operator 1.29.0
    namespace: "cnpg-system",
    repositoryOpts: {
      repo: "https://cloudnative-pg.io/charts/",
    },
    values: {
      replicaCount: 1,
      config: {
        data: {
          KUBERNETES_CLUSTER_DOMAIN: "cluster.local",
        },
      },
    },
  },
  { dependsOn: [cnpgNamespace] }
);
