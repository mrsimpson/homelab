import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * Container Registry Secrets - Manages ImagePullSecrets for private registries
 *
 * Creates ExternalSecrets for pulling images from private container registries:
 * - GitHub Container Registry (GHCR)
 * - Docker Hub
 * - AWS ECR
 * - GCP GCR
 * - Custom registries
 *
 * Secrets are synced from Pulumi ESC and distributed to all namespaces
 * where applications need to pull private images.
 */

export interface RegistrySecretsArgs {
  /** External Secrets Operator resource to depend on */
  externalSecretsOperator: pulumi.Resource;
  /** ClusterSecretStore name (defaults to "pulumi-esc") */
  storeName?: string;
  /** List of namespaces to create the pull secret in (defaults to ["default"]) */
  namespaces?: string[];
}

/**
 * Creates GHCR (GitHub Container Registry) pull secret via External Secrets Operator
 *
 * This function creates an ExternalSecret that pulls GitHub credentials from Pulumi ESC
 * and creates a dockerconfigjson secret for pulling private GHCR images.
 *
 * IMPORTANT: Before using this function, you MUST configure your GitHub credentials
 * in your Pulumi ESC environment with these keys:
 *
 * For Pulumi ESC environment (recommended):
 *   1. Create a GitHub Personal Access Token (PAT) with `read:packages` scope:
 *      - Go to https://github.com/settings/tokens/new
 *      - Select scopes: "read:packages" minimum
 *      - Generate and copy the token
 *
 *   2. Create/update your Pulumi ESC environment with:
 *      ```yaml
 *      values:
 *        github-username: your-github-username
 *        github-token: your-github-token  # Mark as secret
 *      ```
 *
 *   3. Alternatively, use pulumi config set:
 *      ```bash
 *      pulumi config set --secret github-token "your-token"
 *      pulumi config set github-username "your-username"
 *      ```
 *
 * The ExternalSecret will then automatically:
 * - Fetch credentials from Pulumi ESC
 * - Create a Kubernetes secret in each target namespace
 * - Automatically refresh credentials every 1 hour
 * - Encode credentials as base64 for dockerconfigjson format
 *
 * Usage:
 *   const ghcrSecret = createGhcrPullSecret({
 *     externalSecretsOperator: externalSecretsOperator,
 *     namespaces: ["nodejs-demo", "app-namespace"],
 *   });
 *
 *   // Then in ExposedWebApp:
 *   imagePullSecrets: [{ name: "ghcr-pull-secret" }]
 *
 * If credentials are not configured, the ExternalSecret will remain pending
 * and pods using the pull secret will fail with ImagePullBackOff errors.
 * Check the ExternalSecret status with:
 *   kubectl describe externalsecret ghcr-pull-secret -n <namespace>
 */
export function createGhcrPullSecret(args: RegistrySecretsArgs, opts?: pulumi.ResourceOptions) {
  const storeName = args.storeName || "pulumi-esc";
  const namespaces = args.namespaces || ["default"];

  // Build dependency list
  const dependencies = [args.externalSecretsOperator];
  if (opts?.dependsOn) {
    const depArray = Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
    dependencies.push(...(depArray as pulumi.Resource[]));
  }

  // Create ExternalSecret in each namespace
  const externalSecrets = namespaces.map(
    (ns) =>
      new k8s.apiextensions.CustomResource(
        `ghcr-pull-secret-${ns}`,
        {
          apiVersion: "external-secrets.io/v1beta1",
          kind: "ExternalSecret",
          metadata: {
            name: "ghcr-pull-secret",
            namespace: ns,
          },
          spec: {
            refreshInterval: "1h",
            secretStoreRef: {
              name: storeName,
              kind: "ClusterSecretStore",
            },
            target: {
              name: "ghcr-pull-secret",
              creationPolicy: "Owner",
              template: {
                type: "kubernetes.io/dockerconfigjson",
                data: {
                  ".dockerconfigjson": pulumi.interpolate`{"auths":{"ghcr.io":{"username":"{{ .github_username }}","password":"{{ .github_token }}","auth":"{{ printf "%s:%s" .github_username .github_token | b64enc }}"}}}`,
                },
              },
            },
            data: [
              {
                secretKey: "github_username",
                remoteRef: {
                  key: "github-username",
                },
              },
              {
                secretKey: "github_token",
                remoteRef: {
                  key: "github-token",
                },
              },
            ],
          },
        },
        { dependsOn: dependencies }
      )
  );

  return {
    externalSecrets,
    secretName: "ghcr-pull-secret",
  };
}

/**
 * Creates Docker Hub pull secret via External Secrets Operator
 *
 * Prerequisites:
 * Store credentials in Pulumi ESC:
 * - Key: dockerhub-credentials/username
 * - Key: dockerhub-credentials/token (secret)
 */
export function createDockerHubPullSecret(
  args: RegistrySecretsArgs,
  opts?: pulumi.ResourceOptions
) {
  const storeName = args.storeName || "pulumi-esc";
  const namespaces = args.namespaces || ["default"];

  // Build dependency list
  const dependencies = [args.externalSecretsOperator];
  if (opts?.dependsOn) {
    const depArray = Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
    dependencies.push(...(depArray as pulumi.Resource[]));
  }

  const externalSecrets = namespaces.map(
    (ns) =>
      new k8s.apiextensions.CustomResource(
        `dockerhub-pull-secret-${ns}`,
        {
          apiVersion: "external-secrets.io/v1beta1",
          kind: "ExternalSecret",
          metadata: {
            name: "dockerhub-pull-secret",
            namespace: ns,
          },
          spec: {
            refreshInterval: "1h",
            secretStoreRef: {
              name: storeName,
              kind: "ClusterSecretStore",
            },
            target: {
              name: "dockerhub-pull-secret",
              creationPolicy: "Owner",
              template: {
                type: "kubernetes.io/dockerconfigjson",
                data: {
                  ".dockerconfigjson": pulumi.interpolate`{
  "auths": {
    "https://index.docker.io/v1/": {
      "username": "{{ .dockerhub_username }}",
      "password": "{{ .dockerhub_token }}",
      "auth": "{{ printf "%s:%s" .dockerhub_username .dockerhub_token | b64enc }}"
    }
  }
}`,
                },
              },
            },
            data: [
              {
                secretKey: "dockerhub_username",
                remoteRef: {
                  key: "dockerhub-credentials/username",
                },
              },
              {
                secretKey: "dockerhub_token",
                remoteRef: {
                  key: "dockerhub-credentials/token",
                },
              },
            ],
          },
        },
        { dependsOn: dependencies }
      )
  );

  return {
    externalSecrets,
    secretName: "dockerhub-pull-secret",
  };
}
