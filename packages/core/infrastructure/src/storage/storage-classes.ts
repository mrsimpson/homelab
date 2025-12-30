import * as k8s from "@pulumi/kubernetes";
import { longhorn } from "./longhorn";

/**
 * Storage Classes for Longhorn
 *
 * Intent-based classes that combine storage behavior with backup policy:
 *
 * - longhorn-persistent: Retain policy + automatic R2 backups
 *   Use for: Databases, critical data (Supabase, PostgreSQL, etc.)
 *
 * - longhorn-uncritical: Retain policy, NO backups
 *   Use for: Caches, temporary data, non-critical files
 *
 * Note: Longhorn volume labels must be set via recurring job groups
 * or manually on volumes. Storage classes define the intent, and the
 * recurring job applies to volumes in specific groups.
 */

/**
 * longhorn-persistent: For critical data with automatic backups
 *
 * - Retain policy: Data is not deleted when PVC is deleted
 * - Backup policy: Volumes must be labeled manually or via Longhorn groups
 * - Binding mode: WaitForFirstConsumer (more efficient)
 * - Use case: Databases, critical configurations, important data
 */
export const persistentStorageClass = new k8s.storage.v1.StorageClass(
  "longhorn-persistent",
  {
    metadata: {
      name: "longhorn-persistent",
      labels: {
        "app.kubernetes.io/name": "longhorn",
        "app.kubernetes.io/component": "storage",
        "homelab/backup-enabled": "true",
      },
      annotations: {
        "storageclass.kubernetes.io/is-default-class": "false",
        "homelab/description": "Persistent storage with automatic R2 backups",
        "homelab/backup-schedule": "daily-2am",
        "homelab/retention": "7-days",
      },
    },
    provisioner: "driver.longhorn.io",
    allowVolumeExpansion: true,
    reclaimPolicy: "Retain",
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      numberOfReplicas: "1",
      staleReplicaTimeout: "30",
      fromBackup: "",
      fsType: "ext4",
      dataLocality: "best-effort",
      // Note: Longhorn volume groups for backup assignment
      recurringJobSelector: '[{"name":"backup-daily","isGroup":true}]',
    },
  },
  {
    dependsOn: [longhorn],
  }
);

/**
 * longhorn-uncritical: For non-critical data without backups
 *
 * - Retain policy: Data is not deleted when PVC is deleted
 * - Backup policy: No automatic backups
 * - Binding mode: WaitForFirstConsumer
 * - Use case: Caches, temporary files, build artifacts
 *
 * Note: Data is retained but NOT backed up to R2.
 * Use this for data that can be recreated or is not valuable long-term.
 */
export const uncriticalStorageClass = new k8s.storage.v1.StorageClass(
  "longhorn-uncritical",
  {
    metadata: {
      name: "longhorn-uncritical",
      labels: {
        "app.kubernetes.io/name": "longhorn",
        "app.kubernetes.io/component": "storage",
        "homelab/backup-enabled": "false",
      },
      annotations: {
        "storageclass.kubernetes.io/is-default-class": "false",
        "homelab/description": "Persistent storage without backups",
        "homelab/backup-schedule": "none",
        "homelab/retention": "none",
      },
    },
    provisioner: "driver.longhorn.io",
    allowVolumeExpansion: true,
    reclaimPolicy: "Retain",
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      numberOfReplicas: "1",
      staleReplicaTimeout: "30",
      fromBackup: "",
      fsType: "ext4",
      dataLocality: "best-effort",
      // No backup recurring job selector for uncritical storage
    },
  },
  {
    dependsOn: [longhorn],
  }
);

// Only export the clean, intent-based storage classes
// Legacy aliases removed for cleaner configuration
