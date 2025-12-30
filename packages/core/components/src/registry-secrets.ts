import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * Helper functions for creating ImagePullSecrets for private container registries.
 *
 * These functions create ExternalSecrets that sync credentials from Pulumi ESC
 * to Kubernetes secrets for pulling private container images.
 */

export interface CreateImagePullSecretArgs {
	/** Namespace to create the secret in */
	namespace: string;
	/** ClusterSecretStore name (defaults to "pulumi-esc") */
	storeName?: string;
	/** External Secrets Operator to depend on (optional) */
	dependsOn?: pulumi.Resource[];
}

/**
 * Creates a GHCR (GitHub Container Registry) ImagePullSecret in the specified namespace.
 *
 * This is a convenience function for apps deployed outside the main homelab infrastructure.
 * It creates an ExternalSecret that pulls GitHub credentials from Pulumi ESC and creates
 * a kubernetes.io/dockerconfigjson secret for pulling private images from ghcr.io.
 *
 * Prerequisites:
 * 1. External Secrets Operator must be installed in the cluster
 * 2. ClusterSecretStore "pulumi-esc" must exist
 * 3. GitHub credentials must be stored in Pulumi ESC:
 *    - Key: github-credentials/username (your GitHub username)
 *    - Key: github-credentials/token (GitHub PAT with read:packages scope)
 *
 * Usage in app deployment:
 * ```typescript
 * import { createGhcrImagePullSecret } from "@mrsimpson/homelab-core-components";
 *
 * // Create the secret in your app's namespace
 * const pullSecret = createGhcrImagePullSecret({
 *   namespace: "my-app",
 * });
 *
 * // Then reference it in your deployment
 * const app = new ExposedWebApp("my-app", {
 *   image: "ghcr.io/username/my-app:latest",
 *   imagePullSecrets: [{ name: "ghcr-pull-secret" }],
 *   // ...
 * });
 * ```
 *
 * @param args Configuration for the ImagePullSecret
 * @returns The created ExternalSecret resource
 */
export function createGhcrImagePullSecret(
	args: CreateImagePullSecretArgs,
): k8s.apiextensions.CustomResource {
	const storeName = args.storeName || "pulumi-esc";

	return new k8s.apiextensions.CustomResource(
		`ghcr-pull-secret-${args.namespace}`,
		{
			apiVersion: "external-secrets.io/v1beta1",
			kind: "ExternalSecret",
			metadata: {
				name: "ghcr-pull-secret",
				namespace: args.namespace,
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
							".dockerconfigjson": `{"auths":{"ghcr.io":{"username":"{{ .github_username }}","password":"{{ .github_token }}","auth":"{{ printf "%s:%s" .github_username .github_token | b64enc }}"}}}`,
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
		{ dependsOn: args.dependsOn },
	);
}

/**
 * Creates a Docker Hub ImagePullSecret in the specified namespace.
 *
 * Prerequisites:
 * 1. External Secrets Operator must be installed
 * 2. ClusterSecretStore "pulumi-esc" must exist
 * 3. Docker Hub credentials in Pulumi ESC:
 *    - Key: dockerhub-credentials/username
 *    - Key: dockerhub-credentials/token
 *
 * @param args Configuration for the ImagePullSecret
 * @returns The created ExternalSecret resource
 */
export function createDockerHubImagePullSecret(
	args: CreateImagePullSecretArgs,
): k8s.apiextensions.CustomResource {
	const storeName = args.storeName || "pulumi-esc";

	return new k8s.apiextensions.CustomResource(
		`dockerhub-pull-secret-${args.namespace}`,
		{
			apiVersion: "external-secrets.io/v1beta1",
			kind: "ExternalSecret",
			metadata: {
				name: "dockerhub-pull-secret",
				namespace: args.namespace,
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
							".dockerconfigjson": `{
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
		{ dependsOn: args.dependsOn },
	);
}
