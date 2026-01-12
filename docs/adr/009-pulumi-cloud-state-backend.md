# ADR 009: Pulumi Cloud for State Backend

## Status

Implemented

## Context

Pulumi requires a backend to store infrastructure state, which contains resource IDs, configuration values, secrets, and dependency graphs. We are currently using local file storage (`pulumi login file://~/.pulumi`), which creates several critical problems.

Local state storage is not backed up (laptop failure means permanent state loss), restricts deployment to a single machine (blocking CI/CD and team collaboration), provides no history of state changes, and makes recovery impossible if state is lost.

This is blocking production use of our infrastructure, as we cannot safely deploy from multiple locations or have any state resilience.

## Decision

We will use Pulumi Cloud (SaaS) as our state backend, with a documented migration path to self-hosted S3 when complete self-hosting becomes required.

Initial setup uses `pulumi login` to store state in Pulumi's managed service. When full self-hosting is needed, we can migrate to MinIO or external S3-compatible storage.

## Consequences

### Positive

- **Zero setup overhead** - `pulumi login` with GitHub authentication works immediately
- **Automatic backups** - Pulumi Cloud provides built-in state backup and versioning
- **Team collaboration** - Multiple developers and CI/CD can access shared state
- **State recovery** - State history allows rollback and disaster recovery
- **Web dashboard** - Visual interface for stack management and deployment history
- **Free tier** - No cost for personal/small projects
- **Migration path** - Can move to self-hosted S3 later without losing state

### Negative

- **External dependency** - Pulumi Cloud outage would block deployments
- **Data location** - Infrastructure state stored outside homelab (violates pure self-hosting)
- **Vendor lock-in risk** - Dependent on Pulumi's service continuity and pricing
- **Internet requirement** - Cannot deploy during internet outages
- **Privacy considerations** - Resource metadata visible to Pulumi (though secrets are encrypted)

### Neutral

- **Free tier limits** - Current usage well within limits, but may need paid plan eventually
- **Learning curve** - Team needs to understand Pulumi Cloud dashboard and concepts
- **Migration complexity** - Future self-hosted migration requires careful planning