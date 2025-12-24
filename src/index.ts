import * as pulumi from "@pulumi/pulumi";

// Main entry point for homelab infrastructure

// Export config for reference
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

// Import base infrastructure which sets up all core components
import { setupBaseInfra } from "@mrsimpson/homelab-base-infra";

// Initialize base infrastructure and get the context
const baseInfra = setupBaseInfra();
export const homelab = baseInfra.context;

// Export core infrastructure outputs for convenience
export const tunnelId = baseInfra.cloudflare.tunnelId;
export const tunnelCname = baseInfra.cloudflare.tunnelCname;

// Applications - Import and create applications here
import { createHelloWorld } from "@mrsimpson/homelab-app-hello-world";

const helloWorldApp = createHelloWorld(homelab);
export const helloWorldUrl = helloWorldApp.url;
