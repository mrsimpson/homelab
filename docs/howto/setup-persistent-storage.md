# How to Set Up Persistent Storage

**Status:** Implementation Complete  
**Storage Solution:** Longhorn + Cloud Backup  
**Prerequisites:** K3s cluster, open-iscsi tools  

This guide covers setting up persistent storage in your homelab using Longhorn distributed storage with automatic cloud backup capabilities.

## Overview

Our persistent storage solution provides:
- **Distributed block storage** via Longhorn
- **Automatic snapshots** and backup
- **Cloud replication** to S3/Backblaze B2
- **Web UI** for management
- **Multiple storage classes** for different workload types

## Prerequisites

### 1. Host System Requirements

Longhorn requires iSCSI tools to be installed on all K3s nodes:

#### Ubuntu/Debian:
```bash
sudo apt update && sudo apt install -y open-iscsi
sudo systemctl enable --now iscsid
```

#### RHEL/CentOS/Fedora:
```bash
# RHEL/CentOS
sudo yum install -y iscsi-initiator-utils

# Fedora
sudo dnf install -y iscsi-initiator-utils

# Enable service
sudo systemctl enable --now iscsid
```

#### Verification:
```bash
# Check if iSCSI tools are available
which iscsiadm
sudo iscsiadm --version

# Verify service is running
sudo systemctl status iscsid
```

### 2. Kubernetes Cluster Requirements

- K3s cluster with sufficient disk space
- Default k3s installation includes required kernel modules
- At least 1GB free disk space per node for Longhorn metadata

## Deployment

The storage infrastructure is automatically deployed as part of the base infrastructure stack:

```bash
# Deploy base infrastructure including storage
npm run up
```

This will create:
- Longhorn system namespace and components
- Storage classes (database, fast, standard)
- Web UI for management
- Storage validator app for testing

## Storage Classes

Three storage classes are created for different use cases:

### `longhorn-database`
- **Use Case:** Critical data (PostgreSQL, etc.)
- **Reclaim Policy:** Retain (data preserved if PVC is deleted)
- **Binding Mode:** Immediate
- **Best For:** Databases, configuration data

### `longhorn-fast`  
- **Use Case:** Application data with quick provisioning
- **Reclaim Policy:** Delete (auto-cleanup)
- **Binding Mode:** WaitForFirstConsumer
- **Best For:** Application logs, temporary data, cache

### `longhorn-standard`
- **Use Case:** General-purpose balanced storage
- **Reclaim Policy:** Delete
- **Binding Mode:** WaitForFirstConsumer  
- **Best For:** General application data

## Using Persistent Storage

### In ExposedWebApp Components

```typescript
const myApp = homelab.createExposedWebApp("my-app", {
  image: "my-image:latest",
  domain: "myapp.example.com",
  port: 3000,
  storage: {
    size: "10Gi",
    storageClass: "longhorn-fast", // or longhorn-database, longhorn-standard
    mountPath: "/app/data",
  },
});
```

### Direct PVC Creation

```typescript
const pvc = new k8s.core.v1.PersistentVolumeClaim("my-pvc", {
  metadata: {
    name: "my-app-data",
    namespace: "my-namespace",
  },
  spec: {
    accessModes: ["ReadWriteOnce"],
    storageClassName: "longhorn-database",
    resources: {
      requests: {
        storage: "50Gi",
      },
    },
  },
});
```

## Management and Monitoring

### Longhorn Web UI

Access the Longhorn UI to manage volumes, snapshots, and backups:

```bash
# Port-forward to access the UI
kubectl port-forward -n longhorn-system service/longhorn-frontend 8080:80

# Open in browser
open http://localhost:8080
```

### Volume Management

```bash
# List volumes
kubectl get pv
kubectl get pvc -A

# Check Longhorn volumes
kubectl get volumes -n longhorn-system

# View volume details
kubectl describe pv <volume-name>
```

### Snapshots and Backups

Longhorn provides automatic snapshot capabilities:

```bash
# List snapshots (via Longhorn UI or CLI)
kubectl get snapshots -n longhorn-system

# Create manual snapshot
# (Use Longhorn UI or create Snapshot resource)
```

## Cloud Backup Configuration

**Note:** Cloud backup configuration will be added in a future update. Currently, snapshots are stored locally.

Planned features:
- Automatic backup to S3/Backblaze B2
- Configurable retention policies
- Disaster recovery procedures

## Troubleshooting

### Common Issues

#### 1. Longhorn Manager Fails to Start

**Error:** `failed to execute: iscsiadm --version`

**Solution:** Install open-iscsi tools (see Prerequisites above)

#### 2. Pods Stuck in Pending State

**Symptoms:** PVC bound but pod not starting

**Check:**
```bash
kubectl describe pod <pod-name>
kubectl describe pvc <pvc-name>
kubectl get events -n <namespace>
```

**Common Causes:**
- Insufficient disk space
- Node not ready for Longhorn
- Storage class misconfiguration

#### 3. Volume Mount Failures

**Check Longhorn status:**
```bash
kubectl get pods -n longhorn-system
kubectl logs -n longhorn-system deployment/longhorn-manager
```

### Verification Steps

#### Test Storage Functionality

A storage validator app is automatically deployed:

```bash
# Check validator status
kubectl get pods -n storage-validator

# Access validator (if exposed)
curl https://storage-validator.your-domain.com
```

#### Manual Volume Test

```bash
# Create test PVC
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: longhorn-fast
  resources:
    requests:
      storage: 1Gi
EOF

# Create test pod
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
spec:
  containers:
  - name: test
    image: busybox
    command: ["sleep", "3600"]
    volumeMounts:
    - name: test-vol
      mountPath: /data
  volumes:
  - name: test-vol
    persistentVolumeClaim:
      claimName: test-pvc
EOF

# Test file persistence
kubectl exec test-pod -- touch /data/test-file
kubectl delete pod test-pod
# Recreate pod and verify file exists
```

## Best Practices

### Storage Planning

1. **Choose appropriate storage class** based on data criticality
2. **Size volumes appropriately** (can be expanded but not shrunk)
3. **Use `longhorn-database`** for critical data that needs retention
4. **Monitor disk usage** on nodes regularly

### Security Considerations

1. **PVC permissions** are set by pod security context
2. **Data encryption** at rest (planned feature)
3. **Access controls** via RBAC for Longhorn resources

### Performance Optimization

1. **Single replica** configuration for single-node setups
2. **Local storage** for best performance
3. **SSD recommended** for Longhorn metadata
4. **Monitor IOPS** and adjust workloads accordingly

## Backup and Recovery

### Current Capabilities

- **Local snapshots** via Longhorn
- **Volume cloning** for testing
- **Cross-node replication** (when multiple nodes available)

### Planned Enhancements

- **Cloud backup integration**
- **Automated backup schedules**
- **Disaster recovery procedures**
- **Cross-cluster replication**

## Migration Guide

### From local-path Storage

If migrating from existing local-path storage:

1. **Create new PVCs** with Longhorn storage class
2. **Copy data** using init containers or job pods
3. **Update application configurations**
4. **Verify data integrity**
5. **Remove old local-path PVCs**

### To Cloud-Native Storage

Future migration paths to cloud-native storage will be documented as the infrastructure evolves.

## Support

For issues specific to this setup:
1. Check the troubleshooting section above
2. Review Kubernetes events and logs
3. Consult [Longhorn documentation](https://longhorn.io/docs/)
4. Open an issue in the homelab repository

---

**Last Updated:** 2025-12-30  
**Next Review:** After cloud backup implementation