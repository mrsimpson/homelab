/**
 * Actions Runner Controller (ARC) Deployment
 *
 * Deploys GitHub's official Actions Runner Controller to manage
 * self-hosted runners on Kubernetes with auto-scaling.
 *
 * Architecture:
 * 1. ARC Controller: Manages runner lifecycle and scaling
 * 2. RunnerScaleSet: Defines runner configuration and scale rules
 * 3. Listener: Polls GitHub for pending workflow jobs
 *
 * References:
 * - https://github.com/actions/actions-runner-controller
 * - https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners-with-actions-runner-controller
 */

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";

export interface ActionsRunnerControllerConfig {
  namespace: pulumi.Input<string>;
  githubScope: pulumi.Input<string>;
  githubToken: pulumi.Input<string>;
  minRunners: pulumi.Input<number>;
  maxRunners: pulumi.Input<number>;
  runtimeClassName?: string;
  runnerLabels: pulumi.Input<string[]>;
  dependsOn?: pulumi.Input<pulumi.Resource>[];
}

export function createActionsRunnerController(
  homelab: HomelabContext,
  config: ActionsRunnerControllerConfig,
) {
  // Create secret for GitHub authentication
  // In production, use External Secrets Operator to sync from Pulumi ESC
  const githubSecret = new k8s.core.v1.Secret(
    "github-runner-secret",
    {
      metadata: {
        name: "github-runner-secret",
        namespace: config.namespace,
      },
      stringData: {
        github_token: config.githubToken,
      },
    },
    {
      provider: homelab.kubernetesProvider,
      dependsOn: config.dependsOn,
    },
  );

  // Deploy ARC Controller via Helm
  // This is the central controller that manages all runner scale sets
  const arcController = new k8s.helm.v3.Release(
    "actions-runner-controller",
    {
      chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller",
      version: "0.13.0", // Latest as of October 2025
      namespace: config.namespace,
      createNamespace: false, // Already created in index.ts
      values: {
        // Resource limits for the controller
        resources: {
          limits: {
            cpu: "500m",
            memory: "512Mi",
          },
          requests: {
            cpu: "100m",
            memory: "128Mi",
          },
        },
        // Security context
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          fsGroup: 1000,
        },
      },
    },
    { provider: homelab.kubernetesProvider },
  );

  // Deploy RunnerScaleSet for this repository/org
  const runnerScaleSet = new k8s.helm.v3.Release(
    "github-runner-scale-set",
    {
      chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
      version: "0.13.0",
      namespace: config.namespace,
      values: {
        // GitHub configuration
        githubConfigUrl: pulumi.interpolate`https://github.com/${config.githubScope}`,
        githubConfigSecret: githubSecret.metadata.name,

        // Scaling configuration
        minRunners: config.minRunners,
        maxRunners: config.maxRunners,

        // Runner labels for workflow targeting
        // Use in workflows with: runs-on: [self-hosted, firecracker]
        runnerLabels: config.runnerLabels,

        // Runner pod template
        template: {
          spec: {
            // Use Firecracker runtime if configured
            ...(config.runtimeClassName
              ? { runtimeClassName: config.runtimeClassName }
              : {}),

            // Security context for runner pods
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              fsGroup: 1000,
              seccompProfile: {
                type: "RuntimeDefault",
              },
            },

            containers: [
              {
                name: "runner",
                image: "ghcr.io/actions/actions-runner:latest",

                // Resource limits per runner
                resources: {
                  limits: {
                    cpu: "2000m",
                    memory: "4Gi",
                  },
                  requests: {
                    cpu: "500m",
                    memory: "1Gi",
                  },
                },

                // Security context for container
                securityContext: {
                  allowPrivilegeEscalation: false,
                  runAsNonRoot: true,
                  capabilities: {
                    drop: ["ALL"],
                  },
                },

                // Environment variables
                env: [
                  {
                    name: "DOCKER_HOST",
                    value: "unix:///var/run/docker.sock",
                  },
                ],

                // Volume mounts for Docker socket and workspace
                volumeMounts: [
                  {
                    name: "work",
                    mountPath: "/home/runner/_work",
                  },
                ],
              },
            ],

            // Volumes
            volumes: [
              {
                name: "work",
                emptyDir: {},
              },
            ],
          },
        },

        // Listener configuration for auto-scaling
        listenerTemplate: {
          spec: {
            containers: [
              {
                name: "listener",
                resources: {
                  limits: {
                    cpu: "200m",
                    memory: "256Mi",
                  },
                  requests: {
                    cpu: "100m",
                    memory: "128Mi",
                  },
                },
              },
            ],
          },
        },
      },
    },
    {
      provider: homelab.kubernetesProvider,
      dependsOn: [arcController],
    },
  );

  return {
    controller: arcController,
    scaleSet: runnerScaleSet,
  };
}
