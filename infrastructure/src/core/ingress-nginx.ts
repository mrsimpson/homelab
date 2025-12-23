import * as k8s from "@pulumi/kubernetes";

/**
 * ingress-nginx - Ingress controller for HTTP(S) routing
 *
 * Provides:
 * - HTTP(S) routing based on hostnames
 * - TLS termination
 * - Load balancing across pods
 */

// Create namespace for ingress-nginx
const namespace = new k8s.core.v1.Namespace("ingress-nginx-ns", {
	metadata: {
		name: "ingress-nginx",
		labels: {
			name: "ingress-nginx",
			"pod-security.kubernetes.io/enforce": "baseline",
			"pod-security.kubernetes.io/audit": "baseline",
			"pod-security.kubernetes.io/warn": "baseline",
		},
	},
});

export const ingressNginx = new k8s.helm.v3.Chart(
	"ingress-nginx",
	{
		chart: "ingress-nginx",
		version: "4.9.0",
		namespace: namespace.metadata.name,
		fetchOpts: {
			repo: "https://kubernetes.github.io/ingress-nginx",
		},
		values: {
			controller: {
				// Use hostNetwork since k3s doesn't have LoadBalancer by default
				hostNetwork: true,
				hostPort: {
					enabled: true,
					ports: {
						http: 80,
						https: 443,
					},
				},
				service: {
					type: "ClusterIP", // Not LoadBalancer (we're on bare metal)
				},
				// Set ingressClass as default
				ingressClassResource: {
					default: true,
				},
			},
		},
	},
	{
		dependsOn: [namespace],
	},
);

export const ingressClass = "nginx";
