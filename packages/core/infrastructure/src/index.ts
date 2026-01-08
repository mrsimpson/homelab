/**
 * @mrsimpson/homelab-core-infrastructure
 *
 * Core infrastructure modules for homelab:
 * - Cloudflare Tunnel setup
 * - cert-manager for TLS
 * - ingress-nginx for HTTP routing
 * - External Secrets Operator for secret management
 *
 * Each module is independent and can be used separately.
 * All modules are re-exported here for convenience.
 */

export * from "./cloudflare";
export * from "./cert-manager";
export * from "./ingress-nginx";
export * from "./external-secrets";
export * from "./registry-secrets";
export * from "./storage";
export * from "./auth";
