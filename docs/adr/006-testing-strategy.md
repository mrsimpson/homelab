# ADR 006: Testing Strategy for Infrastructure

## Status

Partially Implemented

### ✅ Implemented:
- **TypeScript Compilation** - `tsc --noEmit` enforced via pre-commit hooks and lint-staged
- **Pulumi Preview** - Validation in `.husky/pre-push` to catch infrastructure errors before deployment
- **Infrastructure Validation** - Longhorn precheck validation job prevents deployment issues

### ❌ Not Yet Implemented:
- **Policy as Code** - No Pulumi CrossGuard policies for security/compliance validation
- **Unit Tests** - No test files or testing framework configuration found
- **Synthetic Monitoring** - No periodic health checks or monitoring policies implemented

## Context

Infrastructure as Code needs testing to prevent misconfigurations and errors from reaching production. Different testing approaches offer different trade-offs between speed, coverage, and operational complexity.

As a homelab project with limited time and resources, we need testing strategies that provide high value with low operational overhead. We want to focus on prevention over detection, and catch errors as early as possible in the development cycle rather than after deployment.

## Decision

We will use a layered testing approach focused on prevention:

1. **TypeScript Compilation** - Automatic type checking catches basic errors ✅ **Implemented**
2. **Pulumi Preview** - Shows planned changes before deployment ✅ **Implemented**  
3. **Policy as Code** - Automated validation of security and compliance rules ❌ **Pending**
4. **Synthetic Monitoring** - Periodic health checks of deployed services ❌ **Pending**
5. **Unit Tests** - Only where complex business logic requires validation ❌ **Pending**
6. **Integration Tests** - Avoided in favor of simpler approaches

This approach prioritizes fast feedback and automation over comprehensive test coverage.

## Consequences

### Positive

- **Early error detection** - TypeScript and Pulumi preview catch most issues before deployment
- **Automated compliance** - Policy as Code enforces security and best practices without manual effort  
- **Rapid feedback** - Type checking and preview run in seconds, not minutes
- **Low operational overhead** - No complex test infrastructure to maintain
- **Prevention focus** - Catches problems before they cause outages
- **Appropriate scope** - Testing investment matches homelab scale and complexity

### Negative

- **Limited integration coverage** - May miss issues that only appear when services interact
- **No performance testing** - Won't catch performance regressions until production  
- **Manual validation required** - Some scenarios still require manual testing after deployment
- **Policy maintenance** - Custom policies need updates as requirements change
- **False confidence** - Passing tests don't guarantee production will work perfectly

### Neutral

- **Selective testing** - Higher complexity components get more testing attention
- **Tool learning** - Team needs to understand policy-as-code concepts and Pulumi preview interpretation
- **Documentation burden** - Need to document which scenarios require manual testing