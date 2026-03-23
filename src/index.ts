import * as nodePath from "node:path";
import * as pulumi from "@pulumi/pulumi";

// Main entry point for homelab infrastructure

// Export config for reference
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

// Scoped config for the opencode app (keys set under the "opencode" namespace)
const opencodeConfig = new pulumi.Config("opencode");

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

// OAuth2-Proxy - GitHub authentication proxy
import { releases as oauth2ProxyReleases } from "@mrsimpson/homelab-core-infrastructure";

export const oauth2ProxyInstances = oauth2ProxyReleases;

// Applications - Import and create applications here
import { createHelloWorld } from "@mrsimpson/homelab-app-hello-world";
import { createNodejsDemo } from "@mrsimpson/homelab-app-nodejs-demo";
import { createOpencode } from "@mrsimpson/homelab-app-opencode";
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

// OAuth2 Demo App - Simple nginx app to test OAuth2-Proxy GitHub authentication
export const oauth2DemoApp = homelab.createExposedWebApp("oauth2-demo", {
  image: "nginxinc/nginx-unprivileged:alpine",
  domain: "oauth2-demo.no-panic.org",
  port: 8080,
  auth: AuthType.OAUTH2_PROXY, // 🔒 Protected by OAuth2-Proxy (GitHub)
  oauth2Proxy: { group: "users" },
  tags: ["auth", "demo", "security", "oauth2-proxy", "github"],
});
export const oauth2DemoUrl = "https://oauth2-demo.no-panic.org";

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

// opencode - AI coding agent, protected by GitHub OAuth
//
// All settings are read from Pulumi config under the "opencode" namespace.
// Set them with:
//
//   # Required — host workspace and node pinning:
//   pulumi config set opencode:hostWorkspacePath "/home/oliver/projects"
//   pulumi config set opencode:hostNode          "flinker"
//
//   # Remote provider credentials (secrets):
//   pulumi config set opencode:anthropicApiKey <key> --secret
//   pulumi config set opencode:openaiApiKey    <key> --secret
//
//   # Local llama.cpp provider (plain values, all optional):
//   pulumi config set opencode:llamaCppBaseUrl   "http://flinker:8080/v1"
//   pulumi config set opencode:llamaCppModelId   "qwen2.5-coder"
//   pulumi config set opencode:llamaCppModelName "Qwen 2.5 Coder (local)"
//
const llamaCppBaseUrl = opencodeConfig.get("llamaCppBaseUrl");
const llamaCppModelId = opencodeConfig.get("llamaCppModelId") ?? "local-model";
const llamaCppModelName = opencodeConfig.get("llamaCppModelName") ?? "Local Model (llama.cpp)";

const opencodeApp = createOpencode(homelab, {
  // Required — host filesystem mount and node pinning
  hostWorkspacePath: opencodeConfig.require("hostWorkspacePath"),
  hostNode: opencodeConfig.require("hostNode"),

  // Local LLM via llama.cpp — only configured when llamaCppBaseUrl is set
  llamaCppBaseUrl: llamaCppBaseUrl,
  llamaCppModels: llamaCppBaseUrl
    ? [
        {
          id: llamaCppModelId,
          name: llamaCppModelName,
          contextLimit: Number(opencodeConfig.get("llamaCppContextLimit") ?? 262144),
          outputLimit: Number(opencodeConfig.get("llamaCppOutputLimit") ?? 8192),
        },
      ]
    : undefined,

  // Config directory — all files under this path are mounted verbatim as
  // ~/.config/opencode/ inside the container (agents, MCP servers, etc.)
  configDir: nodePath.join(__dirname, "../packages/apps/opencode/config"),

  // Remote provider credentials — add keys for whichever providers you use
  providerEnv: [
    { name: "ANTHROPIC_API_KEY", value: opencodeConfig.requireSecret("anthropicApiKey") },
    // { name: "OPENAI_API_KEY", value: opencodeConfig.requireSecret("openaiApiKey") },
  ],
});
export const opencodeUrl = opencodeApp.url;
