import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

/**
 * Configures Longhorn storage nodes with disk specifications
 *
 * In single-node K3s clusters, the host system doesn't have dedicated storage disks.
 * This module creates a Longhorn Node CRD that explicitly configures the default data path
 * as a storage location, enabling Longhorn to function on the control plane node.
 *
 * Without this configuration, Longhorn's disk auto-discovery fails because:
 * - Auto-discovery expects dedicated block devices or labeled disks
 * - K3s single-node setups don't have separate disk partitions
 * - We need to explicitly designate the default data path for storage
 */

export interface LonghornNodeConfig {
  nodeName: string;
  dataPath: string;
  dependencies?: pulumi.Resource[];
}

/**
 * Create a Longhorn Node resource with disk configuration for a K3s node
 * This enables Longhorn to use the default data path for volume storage
 */
export function createLonghornNodeConfig(
  args: LonghornNodeConfig
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    `longhorn-node-config-${args.nodeName}`,
    {
      apiVersion: "longhorn.io/v1beta2",
      kind: "Node",
      metadata: {
        name: args.nodeName,
        namespace: "longhorn-system",
      },
      spec: {
        name: args.nodeName,
        disks: {
          [args.nodeName]: {
            path: args.dataPath,
            allowScheduling: true,
            evictionRequested: false,
            storageReserved: 0, // Longhorn will auto-calculate based on minimalAvailable
            tags: [],
          },
        },
      },
    },
    {
      dependsOn: args.dependencies || [],
    }
  );
}
