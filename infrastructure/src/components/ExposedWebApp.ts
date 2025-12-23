import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "../config";
import { letsEncryptIssuer } from "../core/cert-manager";
import { tunnelCname } from "../core/cloudflare";
import { externalSecretsOperator } from "../core/external-secrets";
import { ingressNginx } from "../core/ingress-nginx";

/**
 * ExposedWebApp - Component for deploying web applications with secure internet exposure
 *
 * Automatically configures:
 * - Kubernetes Deployment
 * - Optional OAuth2 Proxy sidecar for authentication
 * - Kubernetes Service (ClusterIP)
 * - Ingress with TLS (cert-manager)
 * - Cloudflare DNS record
 * - Cloudflare Tunnel route
 * - Optional persistent storage
 *
 * Example:
 *   new ExposedWebApp("blog", {
 *     image: "ghost:5",
 *     domain: "blog.example.com",
 *     port: 2368,
 *     oauth: {
 *       provider: "google",
 *       clientId: "...",
 *       clientSecret: pulumi.secret("..."),
 *       allowedEmails: ["admin@example.com"]
 *     },
 *     storage: {
 *       size: "10Gi",
 *       mountPath: "/var/lib/ghost/content"
 *     }
 *   });
 */

export interface OAuthConfig {
	provider: "google" | "github" | "oidc";
	clientId: string;
	clientSecret: pulumi.Output<string>;
	allowedEmails?: string[];
	oidcIssuerUrl?: string;
}

export interface StorageConfig {
	size: string;
	mountPath: string;
	storageClass?: string;
}

export interface ExposedWebAppArgs {
	image: string;
	domain: string | pulumi.Output<string>;
	port: number;
	replicas?: number;
	env?: Array<{ name: string; value: string | pulumi.Output<string> }>;
	oauth?: OAuthConfig;
	storage?: StorageConfig;
	resources?: {
		requests?: { cpu?: string; memory?: string };
		limits?: { cpu?: string; memory?: string };
	};
	tags?: string[];
}

export class ExposedWebApp extends pulumi.ComponentResource {
	public readonly deployment: k8s.apps.v1.Deployment;
	public readonly service: k8s.core.v1.Service;
	public readonly ingress: k8s.networking.v1.Ingress;
	public readonly dnsRecord: cloudflare.Record;
	public readonly pvc?: k8s.core.v1.PersistentVolumeClaim;

	constructor(
		name: string,
		args: ExposedWebAppArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("homelab:ExposedWebApp", name, {}, opts);

		const childOpts = { parent: this };

		// Create namespace for the app
		const namespace = new k8s.core.v1.Namespace(
			`${name}-ns`,
			{
				metadata: {
					name: name,
					labels: {
						app: name,
						environment: pulumi.getStack(),
						// Pod Security Standards enforcement (restricted)
						"pod-security.kubernetes.io/enforce": "restricted",
						"pod-security.kubernetes.io/audit": "restricted",
						"pod-security.kubernetes.io/warn": "restricted",
					},
				},
			},
			childOpts,
		);

		// Optional: Create PVC for persistent storage
		if (args.storage) {
			this.pvc = new k8s.core.v1.PersistentVolumeClaim(
				`${name}-pvc`,
				{
					metadata: {
						name: `${name}-storage`,
						namespace: namespace.metadata.name,
					},
					spec: {
						accessModes: ["ReadWriteOnce"],
						storageClassName: args.storage.storageClass || "local-path",
						resources: {
							requests: {
								storage: args.storage.size,
							},
						},
					},
				},
				childOpts,
			);
		}

		// Optional: Create OAuth2 Proxy configuration
		// Uses External Secrets Operator to pull secrets from Pulumi ESC
		let oauthSecretName: pulumi.Output<string> | undefined;
		if (args.oauth) {
			const oauthExternalSecret = new k8s.apiextensions.CustomResource(
				`${name}-oauth`,
				{
					apiVersion: "external-secrets.io/v1beta1",
					kind: "ExternalSecret",
					metadata: {
						name: `${name}-oauth`,
						namespace: namespace.metadata.name,
					},
					spec: {
						refreshInterval: "1h", // Sync from Pulumi ESC every hour
						secretStoreRef: {
							name: "pulumi-esc",
							kind: "ClusterSecretStore",
						},
						target: {
							name: `${name}-oauth`,
							creationPolicy: "Owner",
						},
						data: [
							{
								secretKey: "clientId",
								remoteRef: {
									key: `${name}/oauth/clientId`,
								},
							},
							{
								secretKey: "clientSecret",
								remoteRef: {
									key: `${name}/oauth/clientSecret`,
								},
							},
							{
								secretKey: "cookieSecret",
								remoteRef: {
									key: `${name}/oauth/cookieSecret`,
								},
							},
						],
					},
				},
				{ ...childOpts, dependsOn: [namespace, externalSecretsOperator] },
			);

			oauthSecretName = oauthExternalSecret.metadata.name;
		}

		// Build container list
		const containers: any[] = [];

		// Main application container
		const appContainer: any = {
			name: "app",
			image: args.image,
			ports: [
				{
					containerPort: args.port,
					name: "http",
				},
			],
			env: args.env || [],
			resources: args.resources || {
				requests: { cpu: "100m", memory: "128Mi" },
				limits: { cpu: "500m", memory: "512Mi" },
			},
		};

		// Add volume mount if storage configured
		if (args.storage && this.pvc) {
			appContainer.volumeMounts = [
				{
					name: "storage",
					mountPath: args.storage.mountPath,
				},
			];
		}

		// If OAuth configured, add oauth2-proxy sidecar
		if (args.oauth && oauthSecretName) {
			const oauthProxyContainer: any = {
				name: "oauth-proxy",
				image: "quay.io/oauth2-proxy/oauth2-proxy:v7.6.0",
				ports: [
					{
						containerPort: 4180,
						name: "oauth-http",
					},
				],
				args: [
					"--http-address=0.0.0.0:4180",
					`--upstream=http://localhost:${args.port}`,
					"--email-domain=*",
					"--cookie-secure=true",
					"--cookie-httponly=true",
					"--set-xauthrequest=true",
				],
				env: [
					{
						name: "OAUTH2_PROXY_CLIENT_ID",
						valueFrom: {
							secretKeyRef: {
								name: oauthSecretName,
								key: "clientId",
							},
						},
					},
					{
						name: "OAUTH2_PROXY_CLIENT_SECRET",
						valueFrom: {
							secretKeyRef: {
								name: oauthSecretName,
								key: "clientSecret",
							},
						},
					},
					{
						name: "OAUTH2_PROXY_COOKIE_SECRET",
						valueFrom: {
							secretKeyRef: {
								name: oauthSecretName,
								key: "cookieSecret",
							},
						},
					},
				],
				resources: {
					requests: { cpu: "10m", memory: "32Mi" },
					limits: { cpu: "100m", memory: "128Mi" },
				},
			};

			// Provider-specific configuration
			if (args.oauth.provider === "google") {
				oauthProxyContainer.args.push("--provider=google");
			} else if (args.oauth.provider === "github") {
				oauthProxyContainer.args.push("--provider=github");
			} else if (args.oauth.provider === "oidc" && args.oauth.oidcIssuerUrl) {
				oauthProxyContainer.args.push("--provider=oidc");
				oauthProxyContainer.args.push(
					`--oidc-issuer-url=${args.oauth.oidcIssuerUrl}`,
				);
			}

			// Email allowlist
			if (args.oauth.allowedEmails) {
				oauthProxyContainer.args.push(
					`--authenticated-emails-file=/dev/null`,
				);
				args.oauth.allowedEmails.forEach((email) => {
					oauthProxyContainer.args.push(`--email-domain=${email.split("@")[1]}`);
				});
			}

			containers.push(oauthProxyContainer);
		}

		containers.push(appContainer);

		// Build volumes list
		const volumes: any[] = [];
		if (args.storage && this.pvc) {
			volumes.push({
				name: "storage",
				persistentVolumeClaim: {
					claimName: this.pvc.metadata.name,
				},
			});
		}

		// Create Deployment
		this.deployment = new k8s.apps.v1.Deployment(
			`${name}-deployment`,
			{
				metadata: {
					name: name,
					namespace: namespace.metadata.name,
					labels: {
						app: name,
						environment: pulumi.getStack(),
					},
				},
				spec: {
					replicas: args.replicas || 1,
					selector: {
						matchLabels: {
							app: name,
						},
					},
					template: {
						metadata: {
							labels: {
								app: name,
							},
						},
						spec: {
							securityContext: {
								runAsNonRoot: true,
								runAsUser: 1000,
								fsGroup: 1000,
							},
							containers: containers,
							volumes: volumes.length > 0 ? volumes : undefined,
						},
					},
				},
			},
			{ ...childOpts, dependsOn: [namespace] },
		);

		// Determine service target port (OAuth proxy if enabled, else app port)
		const servicePort = args.oauth ? 4180 : args.port;

		// Create Service
		this.service = new k8s.core.v1.Service(
			`${name}-service`,
			{
				metadata: {
					name: name,
					namespace: namespace.metadata.name,
				},
				spec: {
					type: "ClusterIP",
					selector: {
						app: name,
					},
					ports: [
						{
							port: 80,
							targetPort: servicePort,
							protocol: "TCP",
							name: "http",
						},
					],
				},
			},
			{ ...childOpts, dependsOn: [this.deployment] },
		);

		// Build dependsOn list - filter out undefined resources
		const ingressDeps: pulumi.Resource[] = [this.service, ingressNginx];
		if (letsEncryptIssuer) {
			ingressDeps.push(letsEncryptIssuer);
		}

		// Update ingress dependency
		this.ingress = new k8s.networking.v1.Ingress(
			`${name}-ingress`,
			{
				metadata: {
					name: name,
					namespace: namespace.metadata.name,
					annotations: {
						"cert-manager.io/cluster-issuer": letsEncryptIssuer
							? "letsencrypt-prod"
							: "skip", // Skip TLS if no issuer
						"nginx.ingress.kubernetes.io/ssl-redirect": "true",
					},
				},
				spec: {
					ingressClassName: "nginx",
					tls: letsEncryptIssuer
						? [
								{
									hosts: [args.domain],
									secretName: `${name}-tls`,
								},
							]
						: undefined,
					rules: [
						{
							host: args.domain,
							http: {
								paths: [
									{
										path: "/",
										pathType: "Prefix",
										backend: {
											service: {
												name: this.service.metadata.name,
												port: {
													number: 80,
												},
											},
										},
									},
								],
							},
						},
					],
				},
			},
			{
				...childOpts,
				dependsOn: ingressDeps,
			},
		);

		// Create Cloudflare DNS record pointing to tunnel
		// cloudflared automatically routes traffic based on HTTP Host header
		this.dnsRecord = new cloudflare.Record(
			`${name}-dns`,
			{
				zoneId: homelabConfig.cloudflare.zoneId,
				name: args.domain,
				type: "CNAME",
				content: tunnelCname,
				proxied: false,
				comment: `Managed by Pulumi - ${name}`,
			},
			childOpts,
		);

		this.registerOutputs({
			deploymentName: this.deployment.metadata.name,
			serviceName: this.service.metadata.name,
			ingressName: this.ingress.metadata.name,
			domain: args.domain,
		});
	}
}
