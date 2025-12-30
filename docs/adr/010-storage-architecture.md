# ADR 010: Storage Architecture for Homelab Kubernetes Cluster

**Status:** Accepted
**Date:** 2025-12-30
**Deciders:** Project maintainers

## Context

Our homelab Kubernetes cluster requires a comprehensive storage solution that can serve both traditional filesystem workloads and modern object storage use cases. The current setup uses k3s's default local-path storage provisioner, which provides basic PersistentVolume support but lacks advanced features required for a modern data platform.

**Current Environment:**
- Single-node k3s cluster (node: flinker)
- 1.9TB NVMe storage with 900GB available
- Existing ExposedWebApp component with PVC mounting capability
- Basic local-path storage provisioner

**Business Requirements:**
The storage solution must support hosting self-hosted Supabase (PostgreSQL-based) as the primary database platform, along with general application workloads. The solution requires database-grade reliability with Kubernetes PVC mounting for PostgreSQL containers and automated cloud backup for disaster recovery. S3 API support is desired for analytics workloads but secondary to the primary database hosting requirements.

## Decision Drivers

**Mandatory Requirements:**
- **Self-hosted Supabase support**: Must provide database-grade storage for PostgreSQL hosting
- **Kubernetes PVC mounting**: Must provide reliable filesystem access via PersistentVolumes
- **Lazy/implicit replication**: Must support automated cloud backup for disaster recovery
- **Pulumi-managed everything**: All configuration must be deployable via Pulumi (no external scripts)
- **Single-node deployment**: Must operate efficiently on a single k3s node with limited resources

**Desired Features:**
- **S3-compatible API**: Enable analytics workloads with parquet/DuckDB (optional)
- **Cost effectiveness**: Minimize operational overhead and external service costs
- **Implementation simplicity**: 4-6 hour weekend project complexity target
- **Existing architecture compatibility**: Must work with current Pulumi Helm patterns

**Operational Constraints:**
- Limited maintenance time availability (homelab environment)
- Single administrator
- Home network environment
- Must integrate with existing infrastructure patterns

## Options Considered

### Option 1: Ceph Unified Cluster

**Description**: Deploy a single-node Ceph cluster using Rook operator, providing both RBD (block storage) for PVCs and RadosGW (S3-compatible object storage) from the same underlying storage pool.

**Pros**:
- **Unified solution**: Single system provides both filesystem and object storage
- **Production-grade**: Battle-tested in enterprise environments
- **Rich feature set**: Built-in replication, snapshots, encryption
- **Kubernetes-native**: Rook operator provides seamless k8s integration
- **S3 compatibility**: RadosGW provides full S3 API compatibility
- **Scalable**: Can add nodes/disks in the future
- **Active development**: Strong community and regular updates

**Cons**:
- **Resource overhead**: Significant CPU/RAM requirements for a single node
- **Complexity**: Complex architecture with multiple daemons (MON, OSD, MGR, RGW)
- **Single point of failure**: No replication benefits on single node
- **Storage efficiency**: ~20-30% overhead for metadata and journals
- **Learning curve**: Requires understanding of Ceph concepts and troubleshooting

**Implementation**:
```yaml
# Rook-Ceph deployment
- Install Rook operator via Pulumi
- Configure single-node cluster with reduced replica settings
- Create CephFilesystem for CephFS PVCs
- Deploy RadosGW for S3 API
- Configure backup to AWS S3/B2 via rclone
```

**Cost**: 
- **Storage efficiency**: ~70% of raw storage available
- **Backup**: ~$5-15/month for cloud storage (depending on data volume)
- **Operational**: High learning curve investment

### Option 2: OpenEBS LocalPV-ZFS + MinIO

**Description**: Hybrid approach using OpenEBS with ZFS for high-performance PVCs and separate MinIO deployment for S3-compatible object storage.

**Pros**:
- **Performance**: ZFS provides excellent performance and data integrity
- **Snapshots**: Built-in ZFS snapshot capabilities
- **Mature components**: Both OpenEBS and MinIO are production-ready
- **Separation of concerns**: Filesystem and object storage optimized independently
- **MinIO features**: Native Iceberg support, excellent S3 compatibility
- **Resource efficiency**: Lower overhead than Ceph

**Cons**:
- **Dual management**: Two separate storage systems to maintain
- **No unified backup**: Separate backup strategies needed
- **ZFS complexity**: Requires ZFS knowledge for troubleshooting
- **Storage duplication**: Data stored in both systems for dual access

**Implementation**:
```yaml
# Two-system approach
- Deploy OpenEBS operator with LocalPV-ZFS
- Create ZFS pool on NVMe device
- Deploy MinIO with dedicated PVC from OpenEBS
- Configure MinIO backup to cloud storage
- Implement separate backup for ZFS datasets
```

**Cost**:
- **Storage efficiency**: ~80% efficiency (ZFS overhead)
- **Backup**: ~$10-20/month (dual backup streams)
- **Operational**: Medium complexity, two systems to learn

### Option 3: Longhorn + External MinIO

**Description**: Use Longhorn for distributed block storage with PVC support, plus external MinIO instance for S3 compatibility and Iceberg support.

**Pros**:
- **Kubernetes-native**: Longhorn designed specifically for k8s
- **Simple deployment**: Easy installation and management via UI
- **Backup integration**: Built-in backup to S3/NFS
- **Snapshot support**: Application-consistent snapshots
- **Monitoring**: Excellent observability and UI
- **Growing popularity**: Strong momentum in k8s community

**Cons**:
- **Single-node limitations**: Replication features wasted on single node
- **Performance overhead**: Network/iSCSI layer even for local storage
- **Dual storage**: Separate MinIO instance required for object storage
- **Resource usage**: Higher overhead than direct filesystem approaches

**Implementation**:
```yaml
# Longhorn + MinIO deployment
- Install Longhorn via Pulumi
- Configure single-replica volumes
- Deploy MinIO on Longhorn PVC
- Set up Longhorn backup to cloud storage
- Configure MinIO backup separately
```

**Cost**:
- **Storage efficiency**: ~75% efficiency
- **Backup**: ~$8-15/month
- **Operational**: Low complexity, excellent documentation

### Option 4: NFS + Rclone + MinIO (Traditional Approach)

**Description**: Set up NFS server for PVC mounting, Rclone for automated backups, and MinIO for S3 compatibility - keeping each component simple and focused.

**Pros**:
- **Simplicity**: Well-understood, traditional components
- **Reliability**: Proven technology stack
- **Flexibility**: Easy to modify and troubleshoot individual components
- **Resource efficiency**: Minimal overhead
- **Backup control**: Granular control over backup strategies

**Cons**:
- **Manual setup**: More manual configuration required
- **Limited features**: No advanced storage features (snapshots, etc.)
- **Three systems**: NFS + Rclone + MinIO to manage
- **No integration**: Components don't work together seamlessly

**Implementation**:
```yaml
# Traditional stack
- Set up NFS server on host
- Configure NFS CSI driver for k8s PVCs
- Deploy Rclone container for automated backups
- Deploy MinIO with NFS-backed storage
- Implement backup orchestration
```

**Cost**:
- **Storage efficiency**: ~95% efficiency
- **Backup**: ~$5-12/month
- **Operational**: Medium complexity, familiar technologies

## Decision

**Selected Option: Longhorn + Cloud Backup (Option 3 - Modified)**

## Rationale

After thorough exploration and evaluation, Longhorn with Pulumi-managed cloud backup provides the optimal solution for hosting self-hosted Supabase and general applications in our homelab environment.

**Key factors in this decision:**

1. **Primary Use Case Alignment**:
   - **Database hosting**: Longhorn provides production-grade block storage suitable for PostgreSQL workloads
   - **Supabase requirements**: Reliable PVC mounting with data persistence guarantees for self-hosted Supabase
   - **Performance**: Block storage optimized for database I/O patterns and consistency requirements

2. **Mandatory Requirement Satisfaction**:
   - **Kubernetes PVC mounting**: Longhorn provides native Kubernetes CSI driver with seamless PVC integration
   - **Pulumi-managed backup**: Longhorn's built-in backup system can be configured entirely via Pulumi Helm charts
   - **Lazy replication**: Automated snapshots with cloud backup provides implicit replication without complexity
   - **Architecture compatibility**: Works perfectly with existing Pulumi Helm deployment patterns

3. **Implementation Simplicity**:
   - **Low-medium complexity**: Assessed as 4-6 hour weekend project (vs. 8-12+ hours for Ceph/ZFS solutions)
   - **Single system**: Unified storage solution eliminates multi-system management overhead
   - **Excellent documentation**: Well-documented with strong community support for troubleshooting

4. **Operational Excellence**:
   - **Kubernetes-native**: Designed specifically for Kubernetes environments with built-in monitoring
   - **Backup integration**: Native S3/B2 backup with snapshot scheduling and retention policies
   - **Resource efficiency**: Appropriate overhead for single-node deployment without wasted replication
   - **Future-proof**: Can leverage replication features when adding additional nodes

5. **Risk Mitigation vs. Alternatives**:
   - **Simpler than Ceph**: Avoids Ceph's complexity and resource overhead for single-node deployment
   - **More integrated than dual-system**: Eliminates coordination complexity between separate storage systems
   - **Production-ready**: Widely adopted in production Kubernetes environments for database workloads
   - **Backup reliability**: Built-in backup system reduces risk of backup configuration drift or failure

## Implementation Strategy

### Phase 1: Core Storage Deployment (2-3 hours)
1. **Longhorn Installation**: Deploy Longhorn via Pulumi Helm chart to `packages/core/infrastructure`
2. **Storage Class Configuration**: Create optimized storage classes for database and general workloads
3. **PVC Validation**: Test PVC creation and mounting with sample application

### Phase 2: Backup Configuration (1-2 hours)
1. **Cloud Storage Setup**: Configure S3/B2 backup target via Longhorn's backup system
2. **Snapshot Policies**: Define automated snapshot schedules and retention policies
3. **Backup Testing**: Validate backup and restore procedures work correctly

### Phase 3: Supabase Deployment (1-2 hours)
1. **Database PVC**: Create dedicated high-performance PVC for PostgreSQL data
2. **Supabase Services**: Deploy self-hosted Supabase components with Longhorn-backed storage
3. **Data Persistence Testing**: Verify database persistence through pod restarts and node reboots

### Phase 4: Integration and Optimization (1 hour)
1. **Performance Monitoring**: Set up Longhorn UI and monitoring integration
2. **Backup Validation**: Confirm automated backups are working correctly
3. **Documentation**: Update deployment and operational procedures

**Pulumi Implementation Pattern**:
```typescript
// packages/core/infrastructure/src/storage/
- longhorn.ts        // Helm chart deployment
- storage-classes.ts // Database and general storage classes  
- backup-config.ts   // S3/B2 backup configuration
```

## Consequences

### Positive

- **Database-grade reliability**: Longhorn provides consistent, durable storage appropriate for PostgreSQL hosting
- **Simplified operations**: Single storage system reduces management overhead and eliminates coordination complexity
- **Excellent Kubernetes integration**: Native CSI driver with seamless PVC mounting and lifecycle management
- **Built-in backup system**: Integrated cloud backup eliminates need for separate backup tooling
- **Pulumi-managed**: All configuration deployable via Helm charts, maintaining infrastructure-as-code principles
- **Implementation speed**: Low-medium complexity enables rapid deployment (4-6 hour implementation)
- **Future scalability**: Can leverage distributed features when adding additional cluster nodes
- **Strong ecosystem**: Active CNCF project with excellent documentation and community support

### Negative

- **Single-node overhead**: Some distributed storage overhead without multi-node replication benefits
- **Network layer**: iSCSI/network layer adds slight latency compared to direct filesystem access
- **Limited S3 API**: No built-in object storage interface requires separate MinIO if S3 API becomes mandatory
- **Backup dependency**: Cloud backup requires reliable internet connection for disaster recovery
- **Learning curve**: Requires understanding Longhorn concepts for troubleshooting and optimization

### Neutral

- **Storage efficiency**: Approximately 90%+ efficiency on single-node (minimal overhead)
- **Resource usage**: Moderate memory and CPU overhead appropriate for homelab scale
- **Backup costs**: Estimated $5-15/month for cloud storage depending on backup retention and data volume
- **Technology choice**: Commits to Longhorn ecosystem vs. more generic storage approaches

## Follow-up Actions

1. **Immediate Implementation (Next Steps)**:
   - Create Longhorn Pulumi component in `packages/core/infrastructure/src/storage/`
   - Configure cloud backup target (S3 or B2) with appropriate retention policies
   - Deploy Longhorn with optimized storage classes for database and general workloads
   - Validate PVC functionality with test workload before Supabase deployment

2. **Supabase Integration**:
   - Create dedicated high-performance storage class for PostgreSQL workloads
   - Deploy self-hosted Supabase with Longhorn-backed persistent volumes
   - Implement database backup validation and restore testing procedures
   - Document Supabase operational procedures specific to Longhorn storage

3. **Operational Excellence**:
   - Set up Longhorn UI access and monitoring integration
   - Establish backup monitoring and alerting (backup success/failure notifications)
   - Create disaster recovery runbooks for database restoration scenarios
   - Plan regular backup and restore testing schedule (monthly validation)

4. **Future Enhancements (Optional)**:
   - Evaluate MinIO deployment for S3 API if analytics workloads require object storage
   - Consider encryption-at-rest for sensitive database data
   - Plan for multi-node expansion and distributed storage when scaling cluster
   - Integrate backup metrics into existing monitoring stack

## References

- [Longhorn Documentation](https://longhorn.io/docs/)
- [Longhorn Backup and Restore](https://longhorn.io/docs/latest/snapshots-and-backups/)
- [Supabase Self-Hosting Guide](https://supabase.com/docs/guides/self-hosting)
- [Kubernetes CSI Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- [Pulumi Kubernetes Helm Charts](https://www.pulumi.com/registry/packages/kubernetes/api-docs/helm/v3/chart/)
- [CNCF Storage Landscape 2024](https://landscape.cncf.io/card-mode?category=cloud-native-storage)