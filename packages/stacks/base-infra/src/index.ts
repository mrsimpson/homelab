/**
 * @mrsimpson/homelab-base-infra
 *
 * Base Infrastructure Stack - Orchestrates all core infrastructure modules
 *
 * This stack sets up:
 * - Cloudflare Tunnel for secure internet exposure
 * - cert-manager for automatic TLS certificates
 * - ingress-nginx for HTTP(S) routing
 * - External Secrets Operator for secret management
 *
 * Exports the infrastructure context that can be used by applications.
 */

import * as pulumi from "@pulumi/pulumi";
import * as coreInfra from "@mrsimpson/homelab-core-infrastructure";
import { baseInfraConfig } from "./config";
import { HomelabContext } from "@mrsimpson/homelab-core-components";

// Export config for reference in other stacks
export { baseInfraConfig };

// Export Pulumi context info
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

/**
 * Sets up and exports all base infrastructure components
 *
 * Returns a context object that can be used by applications to create
 * ExposedWebApp instances with infrastructure dependencies injected.
 */
export function setupBaseInfra() {
	// Create HomelavContext for dependency injection
	const homelabContext = new HomelabContext({
		cloudflare: {
			zoneId: baseInfraConfig.cloudflare.zoneId,
			tunnelCname: coreInfra.tunnelCname,
		},
		tls: {
			clusterIssuer: coreInfra.letsEncryptIssuer,
			clusterIssuerName: coreInfra.clusterIssuerName,
		},
		ingress: {
			controller: coreInfra.ingressNginx,
		},
		externalSecrets: {
			operator: coreInfra.externalSecretsOperator,
		},
	});

	// Auto-discover monorepo apps and create GHCR pull secrets
	// This reads the packages/apps directory to find all monorepo apps
	const fs = require("fs");
	const path = require("path");
	const appsDir = path.join(__dirname, "../../../apps");

	let monorepoAppNamespaces = ["default"]; // Always include default

	try {
		if (fs.existsSync(appsDir)) {
			const appDirs = fs.readdirSync(appsDir, { withFileTypes: true })
				.filter((dirent: any) => dirent.isDirectory())
				.map((dirent: any) => dirent.name);

			monorepoAppNamespaces = [...monorepoAppNamespaces, ...appDirs];
			pulumi.log.info(`Auto-discovered monorepo apps: ${appDirs.join(", ")}`);
		}
	} catch (error) {
		pulumi.log.warn(`Could not read apps directory: ${error}`);
	}

	// Create GHCR pull secret for private container images
	// This creates ImagePullSecrets in all discovered monorepo app namespaces
	// External apps can create their own using createGhcrImagePullSecret() helper
	const ghcrPullSecret = coreInfra.createGhcrPullSecret({
		externalSecretsOperator: coreInfra.externalSecretsOperator,
		namespaces: monorepoAppNamespaces,
	});

	// Export infrastructure details
	return {
		context: homelabContext,
		cloudflare: {
			tunnel: coreInfra.tunnel,
			tunnelCname: coreInfra.tunnelCname,
			tunnelId: coreInfra.tunnelId,
		},
		certManager: {
			letsEncryptIssuer: coreInfra.letsEncryptIssuer,
			clusterIssuerName: coreInfra.clusterIssuerName,
		},
		ingress: {
			ingressNginx: coreInfra.ingressNginx,
		},
		externalSecrets: {
			externalSecretsOperator: coreInfra.externalSecretsOperator,
		},
		registrySecrets: {
			ghcrPullSecret: ghcrPullSecret,
		},
	};
}
