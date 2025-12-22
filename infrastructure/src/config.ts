import * as pulumi from "@pulumi/pulumi";

/**
 * Homelab configuration
 *
 * Set via: pulumi config set <key> <value>
 * Secrets via: pulumi config set <key> <value> --secret
 */

const config = new pulumi.Config();

export const homelabConfig = {
	// Cloudflare configuration
	cloudflare: {
		accountId: config.require("cloudflareAccountId"),
		zoneId: config.require("cloudflareZoneId"),
		// API token set via: pulumi config set cloudflare:apiToken <token> --secret
	},

	// Domain configuration
	domain: config.require("domain"), // e.g., "example.com"

	// Optional: NFS storage configuration
	nfs: {
		server: config.get("nfsServer"), // e.g., "192.168.1.100"
		path: config.get("nfsPath") || "/volume1/k3s",
	},

	// Cluster configuration
	cluster: {
		name: config.get("clusterName") || "homelab",
		namespace: config.get("namespace") || "default",
	},
};

export { config };
