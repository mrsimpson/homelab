# ADR 008: Secrets Management with External Secrets Operator

## Status

Implemented

## Context

Applications require secrets (API keys, database passwords, OAuth credentials) that must be stored securely, accessible to Kubernetes applications, rotatable, and auditable.

The current approach uses Pulumi encrypted config (`pulumi config set --secret`), which works with our existing workflow and encrypts secrets in stack files. However, it lacks automatic rotation capabilities, makes centralized management across applications difficult, complicates secret sharing between stacks, and requires manual Pulumi updates for rotation.

We need a more flexible secrets management solution that can handle various rotation requirements while integrating with our existing Pulumi workflow.

## Decision

We will use External Secrets Operator (ESO) with Pulumi ESC as the initial backend, and add rotation-capable backends (Vault, cloud providers) as needed.

ESO will sync secrets from external stores into Kubernetes Secrets that applications consume. This provides separation between secret storage and delivery, while allowing us to start simple and add sophistication incrementally.

## Consequences

### Positive

- **Separation of concerns** - Secret storage is decoupled from secret delivery to applications
- **Flexibility** - Can start with simple backends and migrate to more sophisticated ones without changing application code
- **Multiple backends** - Can use different secret stores for different types of secrets (static vs. dynamic)
- **Pulumi integration** - Native Pulumi ESC support fits our existing IaC workflow
- **Operational simplicity** - Lightweight operator with no additional infrastructure when using Pulumi ESC
- **Migration path** - Clear upgrade path to rotation-capable backends like Vault when needed
- **No vendor lock-in** - Can swap between 40+ supported backends

### Negative

- **Additional complexity** - Introduces another component (ESO) between secret stores and applications
- **New operational model** - Team must learn ExternalSecret resource management and troubleshooting
- **Migration effort** - Must convert existing apps from direct Pulumi config to ExternalSecret pattern
- **Dependency on ESO** - Secret delivery fails if operator is down (though k8s Secrets remain cached)
- **Limited rotation** - Initial Pulumi ESC backend doesn't provide automatic rotation for most secret types

### Neutral

- **Resource overhead** - ~50MB memory for ESO operator
- **Learning curve** - Need to understand ESO concepts and configuration patterns
- **Backup considerations** - Must ensure external secret stores are properly backed up
