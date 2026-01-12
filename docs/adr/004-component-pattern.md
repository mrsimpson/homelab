# ADR 004: Component-Based Infrastructure Pattern

## Status

Implemented

## Context

Managing Kubernetes resources directly (Deployments, Services, Ingress, PVCs) leads to duplication across similar services, error-prone configuration, difficulty maintaining consistency, and makes it hard to understand intent from raw manifests.

Deploying a simple web application requires multiple Kubernetes resources that get copied and pasted for each application, with subtle variations and bugs introduced each time.

We need a way to create reusable infrastructure patterns that hide complexity behind simple interfaces while maintaining the benefits of Infrastructure as Code.

## Decision

We will use Pulumi ComponentResource pattern to create reusable infrastructure abstractions.

Components will encapsulate common deployment patterns (like `ExposedWebApp`, `Database`) and present simple, type-safe interfaces that hide the underlying resource complexity.

## Consequences

### Positive

- **Reduced duplication** - Define infrastructure patterns once, reuse everywhere
- **Error reduction** - Type-safe interfaces prevent common configuration mistakes
- **Consistent behavior** - All instances of a pattern behave identically
- **Intent clarity** - Component names and parameters express what you want, not how to build it
- **Easy maintenance** - Fix or improve a component and all instances benefit
- **Developer productivity** - Simple interfaces reduce cognitive load and deployment time
- **Composability** - Components can use other components to build higher-level abstractions

### Negative

- **Learning curve** - Team must understand ComponentResource concepts and patterns
- **Abstraction overhead** - May need to modify components when underlying requirements change
- **Initial investment** - Takes time to design and build good component interfaces
- **Debug complexity** - Issues may require understanding both the component and underlying resources
- **Version management** - Component changes can affect multiple applications

### Neutral

- **Code organization** - Components need logical structure and clear interfaces
- **Documentation burden** - Components require good documentation of parameters and behavior
- **Testing strategy** - Components should be tested independently from their usage