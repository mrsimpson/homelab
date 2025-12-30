import * as k8s from "@pulumi/kubernetes";
import { createLonghornPrecheck } from "./validation";
import { backupTargetRoot, logR2Status, hasBackupCredentials } from "./r2-buckets";
import { getBackupConfig, createBackupSecret, createDailyBackupJob } from "./backup";

/**
 * Longhorn - Distributed block storage for Kubernetes
 *
 * Provides:
 * - Distributed storage across nodes
 * - Built-in snapshots and backup
 * - Automatic R2 cloud backup integration
 * - Web UI for management
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

// Create daily backup recurring job if credentials are available
const dailyBackupJob = createDailyBackupJob("longhorn-system");

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
  }
);

// Run prerequisite validation before deploying Longhorn
const precheckJob = createLonghornPrecheck(namespace.metadata.name);

// Log R2 backup status
logR2Status();

export const longhornNamespace = "longhorn-system";
export const longhornPrecheck = precheckJob;
export const longhornBackupSecret = backupSecret;
export const longhornBackupJob = dailyBackupJob;
