import * as pulumi from "@pulumi/pulumi";

// Main entry point for homelab infrastructure
// Import your apps here as you create them

const config = new pulumi.Config();

// Export config for reference
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

// TODO: Import core infrastructure
// import "./core/cloudflare";
// import "./core/cert-manager";
// import "./core/ingress-nginx";

// TODO: Import applications
// import "./apps/blog";
// import "./apps/dashboard";
