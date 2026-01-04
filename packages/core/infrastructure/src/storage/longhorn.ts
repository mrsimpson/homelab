import * as k8s from "@pulumi/kubernetes";
import { createBackupSecret, createDailyBackupJob, getBackupConfig } from "./backup";
import { backupTargetRoot, hasBackupCredentials, logR2Status } from "./r2-buckets";
import { createLonghornPrecheck } from "./validation";
import { createLonghornNodeConfig } from "./node-config";

/**
 * Longhorn - Distributed block storage for Kubernetes
 *
 * Provides:
 * - Distributed storage across nodes
 * - Built-in snapshots and backup
 * - Automatic R2 cloud backup integration
 * - Web UI for management
 *
 * Note on Helm Lifecycle Hooks:
 * The Longhorn Helm chart includes lifecycle hooks (pre-upgrade, pre-delete, post-upgrade).
 * These hooks run during Helm operations but may fail in certain conditions:
 * - pre-delete hook requires deleting-confirmation-flag=true to proceed
 * - pre-upgrade hook runs even during fresh installations
 *
 * These hooks are not critical for core functionality (manager, driver, UI all work fine).
 * We skip awaiting on them to allow deployment to complete. The hooks run asynchronously
 * without blocking storage operations.
 */

// Create namespace for Longhorn
const namespace = new k8s.core.v1.Namespace("longhorn-ns", {
  metadata: {
    name: "longhorn-system",
    labels: {
      name: "longhorn-system",
      "pod-security.kubernetes.io/enforce": "privileged",
      "pod-security.kubernetes.io/audit": "privileged",
      "pod-security.kubernetes.io/warn": "privileged",
    },
  },
});

// Get backup configuration for Longhorn Helm values
const backupConfig = getBackupConfig();

// Create backup secret if credentials are available
const backupSecret = hasBackupCredentials()
  ? createBackupSecret("longhorn-system", backupConfig)
  : undefined;

// Install Longhorn via Helm with conditional R2 backup integration
export const longhorn = new k8s.helm.v3.Chart(
  "longhorn",
  {
    chart: "longhorn",
    version: "1.7.2",
    namespace: "longhorn-system",
    fetchOpts: {
      repo: "https://charts.longhorn.io",
    },
    values: {
      csi: {
        kubeletRootDir: "/var/lib/kubelet", // k3s default
        // Single-node optimization: reduce CSI component replicas
        attacher: { replicas: 1 },
        provisioner: { replicas: 1 },
        resizer: { replicas: 1 },
        snapshotter: { replicas: 1 },
      },
      defaultSettings: {
        // Single node configuration
        defaultReplicaCount: 1,
        replicaSoftAntiAffinity: false,

        // Storage configuration
        createDefaultDiskLabeledNodes: true,
        defaultDataPath: "/var/lib/longhorn/",
        storageOverProvisioningPercentage: 200,
        storageMinimalAvailablePercentage: 25,

        // Conditional R2 backup configuration
        ...(hasBackupCredentials()
          ? {
              backupTarget: backupTargetRoot,
              backupTargetCredentialSecret: "longhorn-backup-secret",
            }
          : {}),

        // Homelab optimizations
        upgradeChecker: false,
        allowRecurringJobWhileVolumeDetached: true,
        autoCleanupSystemGeneratedSnapshot: true,
      },
      longhornUI: {
        replicas: 1,
      },
      longhornManager: {
        tolerations: [
          {
            key: "node-role.kubernetes.io/master",
            operator: "Exists",
            effect: "NoSchedule",
          },
          {
            key: "node-role.kubernetes.io/control-plane",
            operator: "Exists",
            effect: "NoSchedule",
          },
        ],
      },
    },
  },
  {
    dependsOn: [namespace, ...(backupSecret ? [backupSecret] : [])],
    // Skip awaiting Helm lifecycle hook Jobs that don't affect core functionality
    transformations: [
      (resource: any) => {
        // Identify lifecycle hook Jobs (pre-upgrade, pre-delete, post-upgrade, uninstall)
        // These may fail but don't block storage operations
        const isHook =
          resource.type === "kubernetes:batch/v1:Job" &&
          (resource.name?.includes("pre-upgrade") ||
            resource.name?.includes("pre-delete") ||
            resource.name?.includes("post-upgrade") ||
            resource.name?.includes("uninstall"));

        if (isHook) {
          // Don't wait for lifecycle hooks - they run asynchronously
          // Core Longhorn components (manager, driver, UI) are unaffected
          resource.opts = resource.opts || {};
          resource.opts.skipAwait = true;
        }

        return resource;
      },
    ],
  }
);

// Create daily backup recurring job AFTER Longhorn is deployed
// The Helm chart deploys the RecurringJob CRD, so we need this dependency
const dailyBackupJob = hasBackupCredentials()
  ? createDailyBackupJob("longhorn-system", { dependsOn: [longhorn] })
  : undefined;

// Run prerequisite validation before deploying Longhorn
const precheckJob = createLonghornPrecheck(namespace.metadata.name);

// Configure Longhorn node disk for K3s single-node cluster
// In single-node K3s, the node "flinker" doesn't have dedicated storage disks.
// We explicitly configure the default data path for Longhorn storage.
// This ensures volumes can be provisioned even without dedicated block devices.
//
// Without this configuration, Longhorn's auto-discovery fails because:
// - Auto-discovery expects labeled disks or separate block devices
// - K3s single-node setups don't have separate disk partitions
// - We need to explicitly designate the default data path for storage
const nodeConfig = createLonghornNodeConfig({
  nodeName: "flinker",
  dataPath: "/var/lib/longhorn/",
  dependencies: [longhorn],
});

// Log R2 backup status
logR2Status();

export const longhornNamespace = "longhorn-system";
export const longhornPrecheck = precheckJob;
export const longhornBackupSecret = backupSecret;
export const longhornBackupJob = dailyBackupJob;
export const longhornNodeConfig = nodeConfig;
