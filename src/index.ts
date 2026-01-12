import * as pulumi from "@pulumi/pulumi";

// Main entry point for homelab infrastructure

// Export config for reference
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

// Import base infrastructure which sets up all core components
import { setupBaseInfra } from "@mrsimpson/homelab-base-infra";

// Import storage infrastructure
import {
  logBackupStatus,
  longhorn,
  persistentStorageClass,
  uncriticalStorageClass,
} from "@mrsimpson/homelab-core-infrastructure";

// Initialize base infrastructure and get the context
const baseInfra = setupBaseInfra();
export const homelab = baseInfra.context;

// Deploy storage infrastructure
// CRITICAL: Export Longhorn Helm release directly so Pulumi tracks it
// Without this, Longhorn may not be deployed even though storage classes depend on it
export const longhornStorage = longhorn;

// Export storage classes - they depend on longhorn Helm release
// This establishes the dependency chain: these classes depend on longhorn
export const storageClasses = {
  persistent: persistentStorageClass, // For critical data with R2 backups
  uncritical: uncriticalStorageClass, // For non-critical data without backups
};

// Verify storage classes were created (helps ensure longhorn is deployed)
pulumi
  .all([persistentStorageClass.metadata.name, uncriticalStorageClass.metadata.name])
  .apply(([persistentName, uncriticalName]) => {
    pulumi.log.info(
      `Storage classes exported: persistent=${persistentName}, uncritical=${uncriticalName}`
    );
  });

// Log backup configuration status
logBackupStatus();

// Export core infrastructure outputs for convenience
export const tunnelId = baseInfra.cloudflare.tunnelId;
export const tunnelCname = baseInfra.cloudflare.tunnelCname;

// Applications - Import and create applications here
import { createHelloWorld } from "@mrsimpson/homelab-app-hello-world";
import { createNodejsDemo } from "@mrsimpson/homelab-app-nodejs-demo";
import { AuthType } from "@mrsimpson/homelab-core-components";

const helloWorldApp = createHelloWorld(homelab);
export const helloWorldUrl = helloWorldApp.url;

const nodejsDemoApp = createNodejsDemo(homelab);
export const nodejsDemoUrl = nodejsDemoApp.url;

// Storage validator - simple nginx-based storage test with automatic R2 backups
export const storageValidatorApp = homelab.createExposedWebApp("storage-validator", {
  image: "nginxinc/nginx-unprivileged:alpine",
  domain: "storage-validator.no-panic.org",
  port: 8080,
  storage: {
    size: "1Gi",
    storageClass: "longhorn-persistent", // Automatically enables R2 backups
    mountPath: "/usr/share/nginx/html/storage",
  },
  tags: ["storage", "validation", "persistent", "longhorn", "backup"],
});
export const storageValidatorUrl = "https://storage-validator.no-panic.org";

// Auth Demo App - Simple nginx app to test forward authentication
export const authDemoApp = homelab.createExposedWebApp("auth-demo", {
  image: "nginxinc/nginx-unprivileged:alpine",
  domain: "auth-demo.no-panic.org",
  port: 8080,
  auth: AuthType.FORWARD, // 🔒 Protected by Authelia forward auth
  tags: ["auth", "demo", "security", "authelia"],
});
export const authDemoUrl = "https://auth-demo.no-panic.org";

// Longhorn UI - Management interface for storage system
// Note: Using portforwarding instead of Ingress to avoid webhook validation race conditions
// To access Longhorn UI:
//   kubectl port-forward -n longhorn-system svc/longhorn-frontend 8080:80
// Then visit: http://localhost:8080

export const longhornUIUrl = "http://localhost:8080 (via port-forward)";
export const longhornUIPortForwardCommand =
  "kubectl port-forward -n longhorn-system svc/longhorn-frontend 8080:80";
export const longhornUI = {
  accessMethod: "portforward",
  command: "kubectl port-forward -n longhorn-system svc/longhorn-frontend 8080:80",
};
