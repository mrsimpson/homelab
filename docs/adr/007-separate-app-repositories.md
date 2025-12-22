# ADR 007: Separate Application Repositories with Published Components

**Status:** Accepted
**Date:** 2024-12-22
**Deciders:** Platform Team

## Context

Application code needs to be organized separately from infrastructure platform code. Two architectural patterns exist:

1. **Monorepo**: Infrastructure and apps in single repository
2. **Separate Repos**: Infrastructure published as package, apps consume it

For a homelab environment, the decision impacts:
- Experimentation velocity
- Code lifecycle management
- Dependency isolation
- Archival and cleanup

## Decision

**Use separate repositories with published components.**

Infrastructure components (ExposedWebApp, etc.) will be published as `@mrsimpson/homelab-components` npm package. Each application exists in its own repository and declares the components package as a dependency.

## Rationale

### Experimentation and Archival
- Applications are experimental by nature in a homelab
- Need ability to archive/delete entire apps cleanly
- No monorepo residue when retiring an app
- Git history stays focused per-app

### Dependency Isolation
- Each app has its own dependency tree
- Removing an app removes all its dependencies
- No shared node_modules pollution
- Clear boundary: what belongs to this app?

### App-Level Monorepos
- Individual apps may themselves be monorepos (frontend + backend + worker)
- Nesting monorepos (platform monorepo → app monorepo) creates complexity
- Separate repos keep hierarchy flat

### Version Pinning
- Apps can stay on older platform versions if needed
- Platform updates don't force app updates
- Gradual migration path for breaking changes
- Each app declares its platform compatibility

## Implementation

### Infrastructure Repository
- Publishes `@mrsimpson/homelab-components` to npm/GitHub Packages
- Exports: ExposedWebApp, configuration helpers, utilities
- Versioned using semantic versioning
- Automated publishing on git tags

### Application Repositories
- Install: `npm install @mrsimpson/homelab-components`
- Import components as regular npm dependencies
- Each app has its own Pulumi stack
- Minimal deployment code (just component usage)

## Consequences

### Positive
- Clean app lifecycle: create, experiment, archive
- No coupling between unrelated apps
- Platform can evolve independently
- Clear dependency graph
- Apps can be open-sourced individually

### Negative
- Publishing step required for infrastructure changes
- Apps must update dependency to get platform features
- Versioning overhead (semver, changelogs)
- Need npm registry or GitHub Packages setup

### Neutral
- More repositories to manage (acceptable for homelab scale)
- CI/CD per repository (standard pattern)

## Alternatives Considered

### Monorepo
**Rejected** because:
- Cannot cleanly remove apps without git history surgery
- Shared dependencies create coupling
- Apps-as-experiments becomes heavyweight
- Scales poorly with throwaway projects

### Git Submodules
**Rejected** because:
- Notoriously painful developer experience
- Version management is unclear
- npm from git is slower than registry
- Doesn't solve the core problem better than npm packages

## Notes

- Publishing to GitHub Packages is free for public repos
- Private packages work with GitHub authentication
- Can automate publishing via GitHub Actions
- Apps reference components like any other npm dependency

## References

- [ADR 004: Component Pattern](./004-component-pattern.md)
- [npm Organizations](https://docs.npmjs.com/organizations)
- [GitHub Packages](https://docs.github.com/en/packages)
