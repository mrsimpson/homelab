import * as k8s from "@pulumi/kubernetes";
import { createBackupSecret, createDailyBackupJob, getBackupConfig } from "./backup";
import { backupTargetRoot, hasBackupCredentials, logR2Status } from "./r2-buckets";
import { createLonghornPrecheck } from "./validation";

/**
 * Longhorn - Distributed block storage for Kubernetes
 *
 * Provides:
 * - Distributed storage across nodes
 * - Built-in snapshots and backup
 * - Automatic R2 cloud backup integration
 * - Web UI for management
 *
 * Note: Longhorn lifecycle hooks (pre-upgrade, post-upgrade, uninstall) can cause
 * field manager conflicts with existing resources. The configuration below uses
 * transformations to skip awaiting on these hooks to prevent state conflicts.
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
    // Transformations to prevent field manager conflicts and state synchronization issues
    // with Longhorn lifecycle hooks
    transformations: [
      (resource: any) => {
        // Skip awaiting Jobs that are Helm lifecycle hooks
        // These can cause field manager conflicts if the namespace or resources are
        // being recreated, or if multiple Pulumi instances try to manage them
        const isLifecycleHook =
          resource.type === "kubernetes:batch/v1:Job" &&
          (resource.name?.includes("pre-upgrade") ||
            resource.name?.includes("post-upgrade") ||
            resource.name?.includes("uninstall"));

        if (isLifecycleHook) {
          // Don't wait for lifecycle hook jobs to complete
          // They often fail or get stuck, but don't affect the actual deployment
          resource.opts = resource.opts || {};
          resource.opts.skipAwait = true;
        }

        return resource;
      },
    ],
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
