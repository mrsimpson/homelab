import { homelabConfig } from "@mrsimpson/homelab-config";
import type { ExposedWebApp, HomelabContext } from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

/**
 * Node.js Demo App - Demonstrates private GHCR image deployment
 *
 * This app demonstrates:
 * - Deployment of private container images from GHCR
 * - ESC-managed secrets for authentication
 * - ExposedWebApp handles security context automatically
 *
 * Usage:
 * import { createNodejsDemo } from "@mrsimpson/homelab-app-nodejs-demo";
 * const { app, url } = createNodejsDemo(homelab);
 */

export function createNodejsDemo(homelab: HomelabContext): {
  app: ExposedWebApp;
  url: pulumi.Output<string>;
} {
  const domain = pulumi.interpolate`nodejs-demo.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp("nodejs-demo", {
    // Private GHCR image - requires imagePullSecrets
    image: "ghcr.io/mrsimpson/nodejs-demo:build-20251229-132149",
    domain,
    port: 3000, // Node.js app port
    replicas: 2, // High availability

    // Resource allocation
    resources: {
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { cpu: "500m", memory: "512Mi" },
    },

    // ImagePullSecret for private GHCR authentication
    // This secret is created by external-secrets from ESC environment
    imagePullSecrets: [{ name: "ghcr-pull-secret" }],

    // Security context - image requires UID 10000
    securityContext: {
      runAsUser: 10000,
      runAsGroup: 10000,
      fsGroup: 10000,
    },

    // Environment variables
    env: [
      { name: "NODE_ENV", value: "production" },
      { name: "PORT", value: "3000" },
    ],

    tags: ["demo", "nodejs", "private-image", "esc-managed"],
  });

  const url = pulumi.interpolate`https://${domain}`;

  return { app, url };
}
