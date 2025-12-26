/**
 * Kata Containers RuntimeClass for Firecracker microVMs
 *
 * This configures Kubernetes to use Kata Containers with Firecracker
 * as the VMM (Virtual Machine Monitor) for enhanced isolation.
 *
 * Requirements:
 * - Kata Containers installed on k3s nodes via kata-deploy or manual installation
 * - containerd configured with devmapper snapshotter
 * - /dev/kvm accessible on nodes
 *
 * References:
 * - https://katacontainers.io/
 * - https://github.com/kata-containers/kata-containers
 */

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";

export interface KataRuntimeClassConfig {
  dependsOn?: pulumi.Input<pulumi.Resource>[];
}

export function createKataRuntimeClass(
  homelab: HomelabContext,
  config?: KataRuntimeClassConfig,
): k8s.node.v1.RuntimeClass {
  /**
   * RuntimeClass defines how containers should be run
   *
   * kata-fc uses Firecracker as the hypervisor, providing:
   * - ~125ms boot time for microVMs
   * - Strong KVM-based isolation
   * - Minimal memory overhead (~5MB per microVM)
   */
  return new k8s.node.v1.RuntimeClass(
    "kata-firecracker",
    {
      metadata: {
        name: "kata-fc",
        labels: {
          "app.kubernetes.io/name": "kata-containers",
          "app.kubernetes.io/component": "runtime",
        },
      },
      // Handler must match containerd runtime plugin name
      // Configured in /etc/containerd/config.toml via kata-deploy
      handler: "kata-fc",

      // Overhead accounts for VM overhead vs container
      // These values may need tuning based on your workload
      overhead: {
        podFixed: {
          // Memory overhead for Firecracker microVM
          memory: "150Mi",
          // CPU overhead for VM management
          cpu: "100m",
        },
      },

      // Scheduling constraints
      scheduling: {
        // Only schedule on nodes with Kata Containers installed
        nodeSelector: {
          "katacontainers.io/kata-runtime": "true",
        },
        // Tolerate dedicated runner nodes if you have them
        tolerations: [
          {
            key: "node-role.kubernetes.io/runner",
            operator: "Exists",
            effect: "NoSchedule",
          },
        ],
      },
    },
    {
      provider: homelab.kubernetesProvider,
      dependsOn: config?.dependsOn,
    },
  );
}
