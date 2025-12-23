import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { homelabConfig } from "../config";

/**
 * Cloudflare Tunnel - Secure ingress without port forwarding
 *
 * Creates:
 * - Cloudflare Tunnel (persistent connection to Cloudflare)
 * - cloudflared deployment in Kubernetes
 * - Tunnel credentials as Kubernetes Secret
 */

// Generate tunnel secret
const tunnelSecret = new random.RandomPassword("tunnel-secret", {
	length: 32,
	special: false,
});

// Create Cloudflare Tunnel
export const tunnel = new cloudflare.ZeroTrustTunnelCloudflared(
	"homelab-tunnel",
	{
		accountId: homelabConfig.cloudflare.accountId,
		name: "homelab-k3s",
		secret: tunnelSecret.result.apply((s) =>
			Buffer.from(s).toString("base64"),
		),
	},
);

// Get tunnel token for cloudflared
export const tunnelToken = tunnel.tunnelToken;

// Export tunnel CNAME for DNS records
export const tunnelCname = tunnel.cname;

// Deploy cloudflared in Kubernetes
const cloudflaredNamespace = new k8s.core.v1.Namespace("cloudflare", {
	metadata: {
		name: "cloudflare",
		labels: {
			"pod-security.kubernetes.io/enforce": "restricted",
			"pod-security.kubernetes.io/audit": "restricted",
			"pod-security.kubernetes.io/warn": "restricted",
		},
	},
});

// Store tunnel token as Secret
const tunnelTokenSecret = new k8s.core.v1.Secret(
	"tunnel-token",
	{
		metadata: {
			name: "tunnel-token",
			namespace: cloudflaredNamespace.metadata.name,
		},
		stringData: {
			token: tunnelToken,
		},
	},
	{
		dependsOn: [cloudflaredNamespace],
	},
);

// Deploy cloudflared daemon
export const cloudflaredDeployment = new k8s.apps.v1.Deployment(
	"cloudflared",
	{
		metadata: {
			name: "cloudflared",
			namespace: cloudflaredNamespace.metadata.name,
		},
		spec: {
			replicas: 2, // HA setup
			selector: {
				matchLabels: {
					app: "cloudflared",
				},
			},
			template: {
				metadata: {
					labels: {
						app: "cloudflared",
					},
				},
				spec: {
					containers: [
						{
							name: "cloudflared",
							image: "cloudflare/cloudflared:2024.12.2",
							args: [
								"tunnel",
								"--no-autoupdate",
								"--metrics",
								"0.0.0.0:2000",
								"run",
								"--token",
								"$(TUNNEL_TOKEN)",
							],
							env: [
								{
									name: "TUNNEL_TOKEN",
									valueFrom: {
										secretKeyRef: {
											name: tunnelTokenSecret.metadata.name,
											key: "token",
										},
									},
								},
							],
							livenessProbe: {
								httpGet: {
									path: "/ready",
									port: 2000,
								},
								initialDelaySeconds: 10,
								periodSeconds: 10,
							},
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
						},
					],
				},
			},
		},
	},
	{
		dependsOn: [tunnelTokenSecret],
	},
);

// Export tunnel ID for creating routes
export const tunnelId = tunnel.id;
