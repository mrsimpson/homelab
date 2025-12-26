/**
 * GitHub Actions Runners Stack with Firecracker Isolation
 *
 * SECURITY MODEL: This stack is designed for UNTRUSTED workloads
 *
 * Threat Model:
 * - GitHub Actions supply chain attacks (malicious actions from marketplace)
 * - Compromised workflow files (untrusted PRs, account takeovers)
 * - Lateral movement to k3s cluster or homelab network
 * - Secrets exfiltration attempts
 *
 * Defense Layers:
 * 1. VM-level isolation: Kata Containers + Firecracker (KVM hypervisor)
 * 2. Network isolation: NetworkPolicies (deny all, allow only GitHub API)
 * 3. Ephemeral execution: Fresh microVM per workflow job
 * 4. No cluster access: Runners cannot access k8s API or other pods
 * 5. Automatic cleanup: microVMs destroyed after each job
 *
 * This stack deploys (all via Pulumi):
 * 1. kata-deploy DaemonSet: Auto-installs Kata Containers on all nodes
 * 2. RuntimeClass (kata-fc): Configures Firecracker as VMM
 * 3. NetworkPolicies: Isolate runners from cluster network
 * 4. Actions Runner Controller: Auto-scaling GitHub runners
 * 5. RunnerScaleSet: Runner pods with Firecracker isolation
 *
 * Prerequisites (one-time bootstrap):
 * - k3s containerd configured for device mapper snapshotter
 * - /dev/kvm accessible on nodes (KVM enabled)
 * - Run: npm run bootstrap:firecracker-nodes
 *
 * See docs/howto/setup-firecracker-runners.md for full guide
 */

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";
import { deployKataContainers } from "./kata-deploy.js";
import { createKataRuntimeClass } from "./kata-runtime.js";
import { createRunnerNetworkPolicies } from "./network-policies.js";
import { createActionsRunnerController } from "./actions-runner-controller.js";

export interface GitHubRunnersConfig {
  /**
   * GitHub repository or organization to register runners for
   * @example "mrsimpson/homelab" or "mrsimpson"
   */
  githubScope: pulumi.Input<string>;

  /**
   * GitHub App Installation ID or Personal Access Token
   * Should be stored in Pulumi ESC or External Secrets
   */
  githubToken: pulumi.Input<string>;

  /**
   * Minimum number of runners to keep ready
   * @default 0
   */
  minRunners?: pulumi.Input<number>;

  /**
   * Maximum number of runners to scale up to
   * @default 5
   */
  maxRunners?: pulumi.Input<number>;

  /**
   * Enable Firecracker isolation via Kata Containers
   * @default true
   */
  useFirecracker?: boolean;

  /**
   * Runner labels for targeting specific workflows
   * @default ["self-hosted", "linux", "x64", "firecracker"]
   */
  runnerLabels?: pulumi.Input<string[]>;
}

export function createGitHubRunners(
  homelab: HomelabContext,
  config: GitHubRunnersConfig,
): pulumi.Output<string> {
  const namespace = "github-runners";
  const useFirecracker = config.useFirecracker ?? true;

  // Create dedicated namespace for runners (isolated from rest of cluster)
  const ns = new k8s.core.v1.Namespace(
    "github-runners-ns",
    {
      metadata: {
        name: namespace,
        labels: {
          "app.kubernetes.io/name": "github-runners",
          // Enforce Pod Security Standards
          "pod-security.kubernetes.io/enforce": "baseline",
          "pod-security.kubernetes.io/audit": "restricted",
          "pod-security.kubernetes.io/warn": "restricted",
        },
      },
    },
    { provider: homelab.kubernetesProvider },
  );

  // LAYER 1: Deploy Kata Containers to all nodes via DaemonSet
  // This auto-installs Firecracker VMM and Kata runtime
  const kataDeploy = deployKataContainers(homelab, {
    dependsOn: ns,
  });

  // LAYER 2: Configure Firecracker RuntimeClass
  // Pods using this runtime will run in isolated microVMs
  let runtimeClassName: string | undefined;
  if (useFirecracker) {
    const kataRuntime = createKataRuntimeClass(homelab, {
      dependsOn: kataDeploy,
    });
    runtimeClassName = kataRuntime.metadata.name as string;
  }

  // LAYER 3: Network isolation policies
  // Deny all traffic except GitHub API (prevent lateral movement)
  const networkPolicies = createRunnerNetworkPolicies(homelab, {
    namespace: ns.metadata.name,
    dependsOn: ns,
  });

  // LAYER 4: Deploy Actions Runner Controller and RunnerScaleSet
  const arc = createActionsRunnerController(homelab, {
    namespace: ns.metadata.name,
    githubScope: config.githubScope,
    githubToken: config.githubToken,
    minRunners: config.minRunners ?? 0,
    maxRunners: config.maxRunners ?? 5,
    runtimeClassName,
    runnerLabels: config.runnerLabels ?? [
      "self-hosted",
      "linux",
      "x64",
      useFirecracker ? "firecracker" : "container",
    ],
    dependsOn: [networkPolicies, ...(runtimeClassName ? [kataDeploy] : [])],
  });

  return pulumi.interpolate`GitHub Actions Runners deployed with VM-level isolation:
- Namespace: ${namespace}
- Isolation: ${useFirecracker ? "Firecracker microVMs (KVM)" : "containers"}
- Network: Isolated via NetworkPolicies
- Ephemeral: Fresh VM per job
- Labels: ${config.runnerLabels?.join(", ") || "self-hosted, linux, x64"}`;
}
