# ADR 011: Centralized Authentication Stack

## Status

Implemented

## Context

The homelab runs multiple types of applications that need authentication: custom applications requiring OIDC, on-premise Supabase requiring an OIDC provider, and open-source containerized applications. The current approach uses oauth2-proxy sidecars, which means configuring authentication separately for each application.

We need a solution that provides single sign-on across all applications, supports OIDC provider capabilities for Supabase, allows per-application access policies, and runs entirely self-hosted. The solution should be resource-efficient and avoid the operational overhead of per-application authentication configuration.

## Decision

We will deploy Authelia with forward authentication at the Gateway API level.

Authelia will act as both the centralized identity provider and authentication proxy, protecting all applications through Traefik Gateway API ForwardAuth middleware. Authentication will be federated to GitHub and Google OAuth providers.

## Consequences

### Positive

- Single sign-on across all applications eliminates the need for multiple authentication flows
- Authelia can provide OIDC endpoints for Supabase integration, meeting the critical requirement for an identity provider
- Forward authentication pattern allows protecting unlimited applications with a single authentication service
- Per-application access policies enable zero-trust security without per-app configuration
- Resource efficiency: one Authelia instance (~100MB) replaces multiple oauth2-proxy sidecars
- Centralized user management and audit logging

### Negative

- Single point of failure: if Authelia is down, all applications become inaccessible
- Migration effort required to refactor the ExposedWebApp component and redeploy existing applications
- Session backend dependency adds database operational overhead
- Team must learn Authelia-specific configuration concepts (ACL policies, OIDC client setup)
- External IdP dependency means authentication fails during GitHub/Google outages

### Neutral

- Technology commitment to Authelia ecosystem
- Trade-off between per-app OAuth configuration complexity and centralized ACL management
- Requires session storage backend (PostgreSQL or Redis)
