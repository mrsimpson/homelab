# ADR-0001: Gateway API Implementation Selection for Authelia Authentication

## Status

Accepted

## Context

Our homelab infrastructure currently uses nginx ingress controller with Authelia v4.38.0 for authentication. The implementation achieves 95% functionality but fails on protected resource access due to HTTP scheme compatibility issues between nginx ingress and Authelia v4.38.0.

### Current Problem
- nginx ingress controller sends HTTP URLs via `X-Original-URL` header to Authelia
- Authelia v4.38.0 security features reject HTTP schemes with error: "Target URL has an insecure scheme 'http'"
- Users experience 500 errors after successful login when accessing protected applications
- Authentication flow works (login portal, session management) but resource protection fails

### Technical Environment
- **Cluster**: k3s v1.34.3 (excellent Gateway API v1+ support)
- **Domain**: no-panic.org with Cloudflare DNS + tunnel
- **Authentication**: Authelia v4.38.0 with SQLite backend
- **Current Stack**: Pulumi infrastructure-as-code, TypeScript/Node.js
- **Applications**: Multiple ExposedWebApp instances requiring authentication

### Business Requirements
- Resolve HTTP scheme compatibility issue immediately
- Maintain existing authentication functionality (95% working features)
- Preserve clean API for application developers (ExposedWebApp pattern)
- Minimize migration complexity and downtime
- Future-proof with Kubernetes-standard approaches

### Evaluation Criteria
1. **Authelia Compatibility**: Native or simple external authentication support
2. **Gateway API Conformance**: Standards compliance and feature completeness  
3. **Implementation Complexity**: Setup time, learning curve, operational overhead
4. **HTTP Scheme Handling**: Proper HTTPS detection to resolve current issue
5. **k3s Integration**: Compatibility with existing cluster setup
6. **Migration Path**: Effort required to transition from nginx ingress

## Decision

We will adopt **Traefik Proxy with Gateway API** as our ingress controller, replacing nginx ingress controller.

### Selected Solution
- **Gateway Implementation**: Traefik Proxy v3.6 with Gateway API v1.4.0 support
- **Authentication Method**: Traefik ForwardAuth middleware integrated with existing Authelia
- **Migration Strategy**: Parallel deployment with gradual application migration
- **API Evolution**: Extend ExposedWebApp component to support Gateway API alongside ingress

## Consequences

### Positive
- **✅ Immediate Problem Resolution**: ForwardAuth middleware handles HTTPS scheme detection correctly
- **✅ Zero Authelia Changes**: Reuse existing Authelia deployment, configuration, and secrets
- **✅ Proven Integration**: Well-documented Traefik + Authelia compatibility
- **✅ Standards Compliance**: Full Gateway API v1.4.0 conformance for future-proofing
- **✅ Low Migration Risk**: Can run parallel to existing nginx ingress during transition
- **✅ Clean Developer API**: Maintain ExposedWebApp pattern with `auth: AuthType.FORWARD`
- **✅ Quick Implementation**: Hours to deploy vs weeks for alternatives

### Negative
- **⚠️ Learning Curve**: Team needs to learn Traefik-specific concepts and configuration
- **⚠️ Operational Changes**: New monitoring, logging, and debugging procedures
- **⚠️ Migration Effort**: Need to update deployment pipelines and documentation

### Neutral
- **ℹ️ Resource Usage**: Similar CPU/memory footprint to nginx ingress
- **ℹ️ Feature Parity**: Traefik provides equivalent routing and TLS capabilities

## Alternatives Considered

### nginx Gateway Fabric
- **Status**: Rejected
- **Reasoning**: No native external authentication support, would require custom solutions

### Kong Ingress Controller  
- **Status**: Rejected
- **Reasoning**: 
  - No ForwardAuth plugin equivalent for external services
  - Only partial Gateway API v1.2.1 conformance
  - Would require custom plugin development in Lua
  - Enterprise features needed for advanced authentication

### Envoy Gateway
- **Status**: Considered but not selected
- **Reasoning**:
  - Has SecurityPolicy with ext_authz support for external authentication
  - Full Gateway API v1.4.0 conformance
  - More complex setup requiring SecurityPolicy + BackendTLSPolicy configuration
  - Higher operational complexity vs Traefik's ForwardAuth middleware
  - Overkill for homelab requirements

### Istio
- **Status**: Considered but not selected  
- **Reasoning**:
  - Excellent external authorization via AuthorizationPolicy CUSTOM action
  - Full Gateway API v1.4.0 conformance + service mesh capabilities
  - Service mesh overhead inappropriate for homelab scale
  - Requires significant operational expertise
  - Much higher complexity than needed

### Cilium
- **Status**: Rejected
- **Reasoning**: Focused on network policies rather than application authentication, no clear Authelia integration path

## Implementation Plan

### Phase 1: Setup (Week 1)
1. Install Gateway API v1.2.1 CRDs (✅ completed)
2. Deploy Traefik with Gateway API provider enabled
3. Create GatewayClass and Gateway resources
4. Configure ForwardAuth middleware for Authelia

### Phase 2: Migration (Week 2-3)
1. Extend ExposedWebApp component with Gateway API support
2. Migrate test applications to validate authentication flow
3. Parallel operation with nginx ingress for safety
4. Update monitoring and alerting for Traefik

### Phase 3: Completion (Week 4)
1. Migrate remaining applications
2. Remove nginx ingress controller
3. Update documentation and runbooks
4. Performance validation and optimization

## References

- [Gateway API Implementations Comparison](https://gateway-api.sigs.k8s.io/implementations/)
- [Traefik Gateway API Documentation](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/providers/kubernetes/kubernetes-gateway/)
- [Traefik ForwardAuth Middleware](https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/http/middlewares/forwardauth/)
- [Authelia Integration Guide](https://www.authelia.com/integration/proxies/traefik/)
- [Gateway API v1.4.0 Conformance Reports](https://github.com/kubernetes-sigs/gateway-api/tree/main/conformance/reports/v1.4.0)