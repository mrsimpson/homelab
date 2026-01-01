import { homelabConfig } from "@mrsimpson/homelab-config";
import type { ExposedWebApp, HomelabContext } from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

/**
 * Storage Validator - Simple webapp to validate persistent storage
 *
 * This app demonstrates:
 * - Persistent storage using Longhorn PVCs
 * - Simple web interface showing storage mount status
 * - Storage persistence validation
 *
 * Usage:
 * import { createStorageValidator } from "@mrsimpson/homelab-app-storage-validator";
 * const { app, url } = createStorageValidator(homelab);
 */

export function createStorageValidator(homelab: HomelabContext): {
  app: ExposedWebApp;
  url: pulumi.Output<string>;
} {
  const domain = pulumi.interpolate`storage-validator.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp("storage-validator", {
    // Use nginx with a simple static page to validate storage mounting
    image: "nginxinc/nginx-unprivileged:alpine",
    domain,
    port: 8080, // Unprivileged nginx runs on port 8080
    replicas: 1,

    // Resource allocation
    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "200m", memory: "256Mi" },
    },

    // Persistent storage mounted to nginx html directory
    storage: {
      size: "1Gi",
      storageClass: "longhorn-persistent", // Use persistent storage with automatic R2 backups
      mountPath: "/usr/share/nginx/html/storage",
    },

    // Environment variables
    env: [{ name: "NGINX_PORT", value: "8080" }],

    tags: ["storage", "validation", "persistent", "longhorn"],
  });

  const url = pulumi.interpolate`https://${domain}`;

  return { app, url };
}
