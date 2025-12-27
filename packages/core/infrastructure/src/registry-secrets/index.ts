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
 * Prerequisites:
 * 1. Create a GitHub Personal Access Token with `read:packages` scope
 * 2. Store credentials in Pulumi ESC:
 *    - Key: github-credentials/username
 *    - Key: github-credentials/token (secret)
 *
 * Usage:
 *   const ghcrSecret = createGhcrPullSecret({
 *     externalSecretsOperator: externalSecretsOperator,
 *   });
 *
 *   // Then in ExposedWebApp:
 *   imagePullSecrets: [{ name: "ghcr-pull-secret" }]
 */
export function createGhcrPullSecret(args: RegistrySecretsArgs) {
	const storeName = args.storeName || "pulumi-esc";
	const namespaces = args.namespaces || ["default"];

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
									".dockerconfigjson": pulumi.interpolate`{
  "auths": {
    "ghcr.io": {
      "username": "{{ .github_username }}",
      "password": "{{ .github_token }}",
      "auth": "{{ printf "%s:%s" .github_username .github_token | b64enc }}"
    }
  }
}`,
								},
							},
						},
						data: [
							{
								secretKey: "github_username",
								remoteRef: {
									key: "github-credentials/username",
								},
							},
							{
								secretKey: "github_token",
								remoteRef: {
									key: "github-credentials/token",
								},
							},
						],
					},
				},
				{ dependsOn: [args.externalSecretsOperator] },
			),
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
export function createDockerHubPullSecret(args: RegistrySecretsArgs) {
	const storeName = args.storeName || "pulumi-esc";
	const namespaces = args.namespaces || ["default"];

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
				{ dependsOn: [args.externalSecretsOperator] },
			),
	);

	return {
		externalSecrets,
		secretName: "dockerhub-pull-secret",
	};
}
