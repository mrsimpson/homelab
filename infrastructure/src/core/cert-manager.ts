import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * cert-manager - Automatic TLS certificate management
 *
 * Provides:
 * - Automatic Let's Encrypt certificate provisioning
 * - Certificate renewal
 * - ClusterIssuer for production certificates
 */

// Install cert-manager via Helm
export const certManager = new k8s.helm.v3.Chart(
	"cert-manager",
	{
		chart: "cert-manager",
		version: "v1.14.0",
		namespace: "cert-manager",
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
		dependsOn: [],
	},
);

// Create ClusterIssuer for Let's Encrypt production
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
				email: "admin@example.com", // TODO: Make configurable
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
	},
);

// Export for use in other modules
export const clusterIssuerName = letsEncryptIssuer.metadata.name;
