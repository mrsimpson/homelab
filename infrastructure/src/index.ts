import * as pulumi from "@pulumi/pulumi";

// Main entry point for homelab infrastructure

const config = new pulumi.Config();

// Export config for reference
export const pulumiProject = pulumi.getProject();
export const pulumiStack = pulumi.getStack();

// Core Infrastructure - These establish the foundation for all apps
// Order matters: cert-manager and ingress-nginx must be ready before apps deploy
import * as certManager from "./core/cert-manager";
import * as ingressNginx from "./core/ingress-nginx";
import * as cloudflare from "./core/cloudflare";
import * as externalSecrets from "./core/external-secrets";

// Export core infrastructure outputs
export const tunnelId = cloudflare.tunnelId;
export const tunnelCname = cloudflare.tunnelCname;
export const externalSecretsNamespace = externalSecrets.externalSecretsNamespace;

// Applications - Add your apps here
import * as helloWorld from "./apps/hello-world";

// Export application URLs for easy access
export const helloWorldUrl = helloWorld.helloWorldUrl;
