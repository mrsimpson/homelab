# ADR 010: Storage Architecture for Homelab Kubernetes Cluster

## Status

Implemented

## Context

Our homelab Kubernetes cluster requires a comprehensive storage solution for both traditional filesystem workloads and object storage use cases. The current setup uses k3s's default local-path storage provisioner, which provides basic PersistentVolume support but lacks advanced features.

The primary requirement is hosting self-hosted Supabase (PostgreSQL-based) as our database platform, which requires database-grade storage reliability, Kubernetes PVC mounting capability, and automated cloud backup for disaster recovery. The solution must operate efficiently on a single k3s node with limited maintenance overhead.

Secondary requirements include S3 API support for analytics workloads and integration with our existing Pulumi-managed infrastructure patterns.

## Decision

We will implement Longhorn distributed block storage as our primary storage solution for the Kubernetes cluster.

Longhorn will provide both PersistentVolume storage for databases and applications, plus built-in backup capabilities to cloud storage (S3/Backblaze B2) for disaster recovery.

## Consequences

### Positive

- **Database-grade reliability** - Longhorn provides the persistence and performance needed for PostgreSQL hosting
- **Kubernetes-native integration** - Built specifically for Kubernetes with proper PVC support and monitoring
- **Built-in backup system** - Native S3/B2 backup eliminates need for separate backup solutions
- **Resource appropriate** - Designed to work efficiently on single-node deployments without wasted overhead
- **Operational simplicity** - Web UI for management and monitoring with minimal maintenance requirements
- **Future scalable** - Can leverage replication features when adding additional nodes later
- **Pulumi manageable** - Deployable via Helm chart through existing infrastructure patterns

### Negative

- **Single point of failure** - No replication on single-node setup (mitigated by cloud backups)
- **Resource overhead** - Additional CPU and memory usage compared to local-path provisioner
- **Storage overhead** - Longhorn metadata and journaling consume some disk space
- **Learning curve** - Team needs to understand Longhorn concepts and troubleshooting
- **Network dependency** - Backup functionality requires internet connectivity

### Neutral

- **Maintenance windows** - Longhorn updates require scheduling during low-usage periods
- **Monitoring requirements** - Need to monitor storage health and backup success
- **Backup costs** - Cloud storage costs for backups (~$5-15/month depending on data size)