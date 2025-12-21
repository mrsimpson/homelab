# ADR 001: Pulumi with TypeScript over YAML-based IaC

**Status:** Accepted
**Date:** 2025-12-21
**Deciders:** Project maintainers

## Context

We need an Infrastructure-as-Code solution for managing a homelab Kubernetes cluster. The traditional approach uses YAML manifests with tools like Helm, Kustomize, or ArgoCD/Flux.

## Decision

Use **Pulumi with TypeScript** for all infrastructure code.

## Rationale

### Why Pulumi?

**Type Safety:**
- TypeScript catches errors at compile time, not deployment time
- IDE autocomplete for all Kubernetes resources and cloud providers
- Refactoring tools work (rename, find references, etc.)

**Real Programming Language:**
- Loops, conditionals, functions native to the language (no templating hacks)
- Package management (npm) for sharing and reusing code
- Can write unit tests for infrastructure
- Familiar to developers (JavaScript/TypeScript ecosystem)

**Component Model:**
- Create reusable abstractions (ExposedWebApp, Database, etc.)
- Encapsulate complex patterns in simple interfaces
- Reduce duplication through proper abstraction

**Multi-Cloud/Multi-Provider:**
- Manage Kubernetes resources AND Cloudflare in the same codebase
- 100+ provider ecosystem
- Consistent interface across providers

**State Management:**
- Built-in state management (like Terraform)
- Supports local, cloud, or self-hosted backends
- Encryption at rest for secrets

### Why TypeScript specifically?

- Stronger type system than Python or Go for this use case
- Better IDE support and tooling
- npm ecosystem is massive
- Async/await for clean promise handling
- Popular and well-understood

## Consequences

### Positive

- **Fewer errors:** Type safety catches mistakes before deployment
- **Faster development:** IDE autocomplete and refactoring
- **Better abstraction:** Component pattern reduces complexity
- **Testable:** Can write unit tests for infrastructure logic
- **One tool:** Pulumi manages k8s, Cloudflare, and future cloud resources

### Negative

- **Learning curve:** Team must learn Pulumi + TypeScript (if not already familiar)
- **State management:** Need to manage Pulumi state (though this is true for any IaC tool)
- **Smaller community:** Smaller than Terraform, though growing rapidly
- **Tool dependency:** Locked into Pulumi ecosystem (though code is just TypeScript)

## Alternatives Considered

### Helm + Kustomize + YAML

**Pros:**
- Industry standard, large ecosystem
- Most Kubernetes users already familiar
- Many pre-built charts available

**Cons:**
- YAML is error-prone (indentation, typos)
- Templating with Go templates is clunky
- No type safety
- Hard to create good abstractions
- Copy-paste culture

**Verdict:** Too error-prone for complex setups

### Terraform + HCL

**Pros:**
- Industry standard for infrastructure
- Mature state management
- Large provider ecosystem

**Cons:**
- HCL is not a real programming language (limited loops, conditionals)
- Kubernetes provider is second-class citizen
- Less suitable for complex k8s resources than Pulumi
- No real functions/classes for abstraction

**Verdict:** Good for cloud infra, not ideal for Kubernetes-heavy workloads

### CDK8s (CDK for Kubernetes)

**Pros:**
- TypeScript/Python for k8s manifests
- Type-safe like Pulumi
- Focused on Kubernetes

**Cons:**
- Only generates YAML (still need another tool to apply it)
- Doesn't manage state
- No multi-cloud (only k8s manifests)
- Would still need Terraform/Pulumi for Cloudflare, etc.

**Verdict:** Too narrow in scope, adds complexity

### Timoni (CUE-based)

**Pros:**
- Type-safe configuration
- Better than Helm for templating

**Cons:**
- CUE is a niche language (steep learning curve)
- Small ecosystem
- Still YAML-centric
- Doesn't solve multi-cloud problem

**Verdict:** Interesting but too experimental

## Implementation Notes

- Use Pulumi's component model for all abstractions
- Keep Pulumi state in encrypted backend (TBD: local vs cloud)
- Document component interfaces with TypeScript JSDoc comments
- Write infrastructure code tests where complexity warrants

## References

- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [Why Pulumi?](https://www.pulumi.com/docs/intro/vs/)
- [Pulumi Kubernetes Provider](https://www.pulumi.com/registry/packages/kubernetes/)
