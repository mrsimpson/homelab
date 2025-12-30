import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import {
	ExposedWebApp,
	createGhcrImagePullSecret,
} from "@mrsimpson/homelab-core-components";

/**
 * Node.js Demo App Deployment
 *
 * Deploys the nodejs-demo app to the homelab using GHCR image.
 */

// Get the base infrastructure outputs via stack reference
const baseInfraStack = new pulumi.StackReference(
  `mrsimpson-org/homelab/${pulumi.getStack()}`,
);

// Get infrastructure outputs from base stack
const tunnelCname = baseInfraStack.getOutput("tunnelCname") as pulumi.Output<string>;

// Create GHCR pull secret in the nodejs-demo namespace using the helper function
// This demonstrates how external apps would create their own ImagePullSecrets
const ghcrPullSecret = createGhcrImagePullSecret({
	namespace: "nodejs-demo",
});

// Configure domain
const appDomain = pulumi.interpolate`nodejs-demo.${homelabConfig.domain}`;

// Get image version - use git SHA for reproducibility
// Set IMAGE_VERSION env var to override (e.g., IMAGE_VERSION=v1.0.0 pulumi up)
const getImageTag = () => {
	if (process.env.IMAGE_VERSION) {
		return process.env.IMAGE_VERSION;
	}
	// Get git SHA from repository
	const { execSync } = require("child_process");
	try {
		const gitSha = execSync("git rev-parse --short HEAD", {
			cwd: __dirname,
			encoding: "utf8"
		}).trim();
		return gitSha;
	} catch (error) {
		pulumi.log.warn("Could not get git SHA, falling back to 'latest'");
		return "latest";
	}
};

const imageVersion = getImageTag();

// Deploy the nodejs-demo app
const app = new ExposedWebApp("nodejs-demo", {
  // Container image from GHCR
  image: `ghcr.io/mrsimpson/nodejs-demo:${imageVersion}`,

  // Domain configuration
  domain: appDomain,

  // Application port (must match EXPOSE in Dockerfile)
  port: 3000,

  // Scaling - run 2 replicas for high availability
  replicas: 2,

  // Resource limits
  resources: {
    requests: {
      cpu: "100m",      // 0.1 CPU core
      memory: "128Mi",  // 128 MiB RAM
    },
    limits: {
      cpu: "500m",      // 0.5 CPU core max
      memory: "512Mi",  // 512 MiB RAM max
    },
  },

  // ImagePullSecret for private GHCR images
  imagePullSecrets: [{ name: "ghcr-pull-secret" }],

  // Environment variables
  env: [
    { name: "NODE_ENV", value: "production" },
    { name: "APP_VERSION", value: imageVersion },
  ],

  // Infrastructure dependencies
  cloudflare: {
    zoneId: homelabConfig.cloudflare.zoneId,
    tunnelCname: tunnelCname,
  },
  tls: {
    clusterIssuerName: "letsencrypt-prod",
  },
  ingress: {
    className: "nginx",
  },

  // Tags for organization
  tags: ["demo", "nodejs", "production"],
});

// Export the application URL
export const url = pulumi.interpolate`https://${appDomain}`;
export const imageTag = imageVersion;
