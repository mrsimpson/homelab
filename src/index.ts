import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
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

// Initialize base infrastructure and get the context (now includes namespaces)
const baseInfra = setupBaseInfra();
export const homelab = baseInfra.context;

// Deploy storage infrastructure
export const longhornStorage = longhorn;
export const storageClasses = {
  persistent: persistentStorageClass, // For critical data with R2 backups
  uncritical: uncriticalStorageClass, // For non-critical data without backups
};

// Log backup configuration status
logBackupStatus();

// Export core infrastructure outputs for convenience
export const tunnelId = baseInfra.cloudflare.tunnelId;
export const tunnelCname = baseInfra.cloudflare.tunnelCname;
// export const autheliaUrl = baseInfra.authelia.autheliaUrl; // TODO: Add this to base infra exports

// Applications - Import and create applications here
import { createHelloWorld } from "@mrsimpson/homelab-app-hello-world";
import { createNodejsDemo } from "@mrsimpson/homelab-app-nodejs-demo";
// import { createSecureDemo } from "@mrsimpson/homelab-app-secure-demo"; // Not available in this branch

const helloWorldApp = createHelloWorld(homelab);
export const helloWorldUrl = helloWorldApp.url;

const nodejsDemoApp = createNodejsDemo(homelab);
export const nodejsDemoUrl = nodejsDemoApp.url;

// const secureDemoApp = createSecureDemo(homelab); // Not available in this branch
// export const secureDemoUrl = secureDemoApp.url;

// Storage validator - simple nginx-based storage test with automatic R2 backups
export const storageValidatorApp = homelab.createExposedWebApp("storage-validator", {
  image: "nginxinc/nginx-unprivileged:alpine",
  domain: "storage-validator.local.mrsimpson.dev",
  port: 8080,
  storage: {
    size: "1Gi",
    storageClass: "longhorn-persistent", // Automatically enables R2 backups
    mountPath: "/usr/share/nginx/html/storage",
  },
  tags: ["storage", "validation", "persistent", "longhorn", "backup"],
});
export const storageValidatorUrl = "https://storage-validator.local.mrsimpson.dev";

// Longhorn UI - Management interface for storage system
// Create basic auth secret for Longhorn UI protection
const longhornBasicAuth = new k8s.core.v1.Secret(
  "longhorn-basic-auth",
  {
    metadata: {
      name: "longhorn-basic-auth",
      namespace: "longhorn-system",
    },
    data: {
      // Default: admin/longhorn123 (change in production)
      // Generated with: echo -n 'admin:$apr1$V2K6rJ2k$6QjREMDJJeVwFCZB3bFn//' | base64
      auth: "YWRtaW46JGFwcjEkVjJLNnJKMmskNlFqUkVNREpKZVZ3RkNaQjNiRm4vLw==",
    },
  },
  { dependsOn: [longhornStorage] }
);

// Create Cloudflare DNS record for Longhorn UI
const longhornDNS = new cloudflare.Record("longhorn-dns", {
  zoneId: "9007d8406ee5b613838ea52c3491e915", // mrsimpson.dev zone
  name: "longhorn.local.mrsimpson.dev",
  type: "CNAME",
  content: tunnelCname,
  comment: "Managed by Pulumi - Longhorn UI",
  proxied: true,
});

// Create ingress for Longhorn UI with basic authentication
const longhornIngress = new k8s.networking.v1.Ingress(
  "longhorn-ui-ingress",
  {
    metadata: {
      name: "longhorn-ui",
      namespace: "longhorn-system",
      annotations: {
        "kubernetes.io/ingress.class": "nginx",
        "cert-manager.io/cluster-issuer": "letsencrypt-prod",
        "nginx.ingress.kubernetes.io/auth-type": "basic",
        "nginx.ingress.kubernetes.io/auth-secret": "longhorn-basic-auth",
        "nginx.ingress.kubernetes.io/auth-realm":
          "Authentication Required - Longhorn Storage Management",
        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
      },
    },
    spec: {
      ingressClassName: "nginx",
      tls: [
        {
          hosts: ["longhorn.local.mrsimpson.dev"],
          secretName: "longhorn-ui-tls",
        },
      ],
      rules: [
        {
          host: "longhorn.local.mrsimpson.dev",
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: "longhorn-frontend",
                    port: { number: 80 },
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
    dependsOn: [longhornStorage, longhornBasicAuth, longhornDNS],
  }
);

export const longhornUIUrl = "https://longhorn.local.mrsimpson.dev";
export const longhornUICredentials = "Username: admin | Password: longhorn123";
export const longhornUI = {
  ingress: longhornIngress,
  auth: longhornBasicAuth,
  dns: longhornDNS,
};
