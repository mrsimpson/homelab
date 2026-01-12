# ADR 012: Gateway API Implementation Selection for Authelia Authentication

## Status

Implemented

## Context

Our homelab infrastructure uses nginx ingress controller with Authelia v4.38.0 for authentication. The implementation works for login flows and session management, but fails when users try to access protected resources after authentication.

The specific problem is that nginx ingress controller sends HTTP URLs via the `X-Original-URL` header to Authelia, while Authelia v4.38.0 security features require HTTPS schemes. This causes "Target URL has an insecure scheme 'http'" errors, resulting in 500 errors for users after successful login.

We need to resolve this HTTP scheme compatibility issue while maintaining our existing Authelia deployment and the clean ExposedWebApp pattern for developers.

## Decision

We will adopt Traefik Proxy with Gateway API as our ingress controller, replacing nginx ingress controller.

Traefik's ForwardAuth middleware will integrate with our existing Authelia deployment to provide external authentication. This will resolve the HTTP scheme issue while maintaining all current authentication functionality.

## Consequences

### Positive

- Resolves the HTTP scheme compatibility issue immediately—Traefik correctly sends HTTPS URLs to Authelia
- Maintains existing Authelia deployment with zero changes to configuration or secrets  
- Well-documented Traefik + Authelia integration with proven compatibility
- Full Gateway API v1.4.0 standards compliance for future-proofing
- Can run in parallel with nginx during migration, reducing risk
- Preserves the clean ExposedWebApp developer pattern
- Quick implementation timeline (hours vs weeks for alternatives)

### Negative

- Team must learn Traefik-specific configuration and operational procedures
- Migration effort required to update deployment pipelines and convert Ingress resources to HTTPRoute resources  
- New monitoring and debugging procedures for Traefik

### Neutral

- Similar resource usage to nginx ingress controller
- Equivalent routing and TLS termination capabilities
- Technology change requires documentation updates
