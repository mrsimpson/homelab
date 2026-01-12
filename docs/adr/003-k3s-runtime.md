# ADR 003: k3s as Container Runtime

## Status

Implemented

## Context

We need a container orchestration platform for running homelab services with infrastructure-as-code management, service discovery, and persistent storage capabilities.

The options range from simple Docker Compose setups to full Kubernetes distributions, each with different complexity and capability trade-offs for a homelab environment.

## Decision

We will use k3s (Lightweight Kubernetes) as our container runtime and orchestration platform.

## Consequences

### Positive

- **Infrastructure as Code native** - Declarative API works perfectly with Pulumi for consistent resource management
- **Service abstraction** - Clean separation between deployments, services, and ingress with built-in service discovery
- **Persistent storage** - PersistentVolumeClaim abstraction with CSI driver ecosystem and dynamic provisioning
- **Extensibility** - Custom Resource Definitions and rich ecosystem of operators and add-ons
- **Lightweight footprint** - ~100MB binary and ~512MB memory usage, appropriate for homelab scale
- **Batteries included** - Includes ingress controller, DNS, and essential components out of the box
- **Production patterns** - Uses same patterns and APIs as enterprise Kubernetes for skill transferability
- **Ecosystem compatibility** - Can run standard Kubernetes applications and Helm charts

### Negative

- **Learning curve** - Kubernetes concepts are complex compared to Docker Compose
- **Resource overhead** - More CPU and memory usage than simple Docker daemon
- **Operational complexity** - More components to monitor and troubleshoot than simpler alternatives
- **Networking complexity** - Kubernetes networking concepts (CNI, Services, etc.) add complexity
- **Over-engineering risk** - May be overkill for simple single-container applications

### Neutral

- **Single-node limitations** - No high availability or load distribution benefits until adding more nodes
- **Storage dependencies** - Requires compatible storage solutions for PersistentVolumes
- **Monitoring needs** - Requires Kubernetes-aware monitoring and logging solutions