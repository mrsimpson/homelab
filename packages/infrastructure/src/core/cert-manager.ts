import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "../config";

/**
 * cert-manager - Automatic TLS certificate management
 *
 * Provides:
 * - Automatic Let's Encrypt certificate provisioning
 * - Certificate renewal
 * - ClusterIssuer for production certificates
 */

const config = new pulumi.Config();

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
	},
);

// Create ClusterIssuer for Let's Encrypt production
// Note: On FIRST deployment, set: pulumi config set homelab:skipClusterIssuer true
// Then after cert-manager is deployed, set: pulumi config set homelab:skipClusterIssuer false
// This avoids preview validation errors when cert-manager webhook doesn't exist yet
const skipClusterIssuer = config.getBoolean("skipClusterIssuer") ?? false;

export let letsEncryptIssuer: k8s.apiextensions.CustomResource | undefined;
export let clusterIssuerName: pulumi.Output<string> | undefined;

if (!skipClusterIssuer) {
	letsEncryptIssuer = new k8s.apiextensions.CustomResource(
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
		},
	);

	clusterIssuerName = letsEncryptIssuer.metadata.name;
} else {
	// Export a dummy value when skipped
	clusterIssuerName = pulumi.output("letsencrypt-prod");
}
