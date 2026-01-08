import * as pulumi from "@pulumi/pulumi";

/**
 * Base Infrastructure Configuration
 *
 * Set via: pulumi config set <key> <value>
 * Secrets via: pulumi config set <key> <value> --secret
 */

const config = new pulumi.Config();

export const baseInfraConfig = {
  // Cloudflare configuration
  cloudflare: {
    accountId: config.require("cloudflareAccountId"),
    zoneId: config.require("cloudflareZoneId"),
    // API token set via: pulumi config set cloudflare:apiToken <token> --secret
  },

  // Domain configuration
  domain: config.require("domain"), // e.g., "example.com"

  // Email for Let's Encrypt certificates
  email: config.require("email"), // e.g., "admin@example.com"

  // cert-manager configuration
  certManager: {
    letsEncryptServer:
      config.get("letsEncryptServer") || "https://acme-v02.api.letsencrypt.org/directory",
  },

  // External Secrets configuration
  externalSecrets: {
    pulumiOrganization: config.require("pulumiOrganization"),
    pulumiAccessToken: config.requireSecret("pulumiAccessToken"),
  },

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
