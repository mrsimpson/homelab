/**
 * Authentication infrastructure module
 *
 * Provides centralized authentication with Authelia:
 * - Forward authentication for ingress-nginx
 * - OIDC provider capability
 * - Social login federation
 * - Multi-factor authentication
 *
 * See ADR 011 for architecture decisions.
 */

export * from "./authelia";
