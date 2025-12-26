/**
 * Kata Containers Deployment via DaemonSet
 *
 * This deploys the official kata-deploy DaemonSet which automatically:
 * 1. Installs Kata Containers runtime on all k3s nodes
 * 2. Configures containerd with Firecracker runtime plugin
 * 3. Labels nodes with katacontainers.io/kata-runtime=true
 * 4. Creates necessary runtime configurations
 *
 * The DaemonSet runs as a privileged init container to configure the host,
 * then runs a monitoring container to maintain the installation.
 *
 * This eliminates manual installation on each node.
 *
 * References:
 * - https://github.com/kata-containers/kata-containers/tree/main/tools/packaging/kata-deploy
 * - https://katacontainers.io/
 */

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import type { HomelabContext } from "@mrsimpson/homelab-core-components";

export interface KataDeployConfig {
  dependsOn?: pulumi.Input<pulumi.Resource>[];
}

export function deployKataContainers(
  homelab: HomelabContext,
  config?: KataDeployConfig,
): k8s.apps.v1.DaemonSet {
  // Create kube-system namespace resources (kata-deploy runs here)
  const kataNamespace = "kube-system";

  // ServiceAccount for kata-deploy
  const serviceAccount = new k8s.core.v1.ServiceAccount(
    "kata-deploy-sa",
    {
      metadata: {
        name: "kata-deploy",
        namespace: kataNamespace,
      },
    },
    {
      provider: homelab.kubernetesProvider,
      dependsOn: config?.dependsOn,
    },
  );

  // ClusterRole with permissions to configure nodes
  const clusterRole = new k8s.rbac.v1.ClusterRole(
    "kata-deploy-role",
    {
      metadata: {
        name: "kata-deploy",
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["nodes"],
          verbs: ["get", "list", "patch", "update"],
        },
        {
          apiGroups: [""],
          resources: ["configmaps"],
          verbs: ["get", "list", "create", "update"],
        },
      ],
    },
    { provider: homelab.kubernetesProvider },
  );

  // ClusterRoleBinding
  const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(
    "kata-deploy-rb",
    {
      metadata: {
        name: "kata-deploy",
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: clusterRole.metadata.name,
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccount.metadata.name,
          namespace: kataNamespace,
        },
      ],
    },
    { provider: homelab.kubernetesProvider },
  );

  // DaemonSet that installs Kata on all nodes
  const kataDaemonSet = new k8s.apps.v1.DaemonSet(
    "kata-deploy",
    {
      metadata: {
        name: "kata-deploy",
        namespace: kataNamespace,
        labels: {
          "app.kubernetes.io/name": "kata-deploy",
          "app.kubernetes.io/component": "runtime",
        },
      },
      spec: {
        selector: {
          matchLabels: {
            name: "kata-deploy",
          },
        },
        updateStrategy: {
          type: "RollingUpdate",
          rollingUpdate: {
            maxUnavailable: 1,
          },
        },
        template: {
          metadata: {
            labels: {
              name: "kata-deploy",
            },
          },
          spec: {
            serviceAccountName: serviceAccount.metadata.name,
            hostPID: true, // Required to configure containerd
            hostNetwork: true, // Required for node access

            // Init container that installs Kata
            initContainers: [
              {
                name: "kata-deploy-install",
                image: "quay.io/kata-containers/kata-deploy:latest",
                imagePullPolicy: "Always",
                command: ["/bin/bash", "-c", "/opt/kata-artifacts/scripts/kata-deploy.sh install"],
                env: [
                  {
                    name: "NODE_NAME",
                    valueFrom: {
                      fieldRef: {
                        fieldPath: "spec.nodeName",
                      },
                    },
                  },
                  // Configure for Firecracker VMM
                  {
                    name: "KATA_HYPERVISOR",
                    value: "firecracker",
                  },
                  // Use devmapper snapshotter
                  {
                    name: "SNAPSHOTTER",
                    value: "devmapper",
                  },
                ],
                securityContext: {
                  privileged: true, // Required to modify host
                },
                volumeMounts: [
                  {
                    name: "host-root",
                    mountPath: "/host",
                  },
                  {
                    name: "containerd-config",
                    mountPath: "/etc/containerd",
                  },
                  {
                    name: "kata-artifacts",
                    mountPath: "/opt/kata-artifacts",
                  },
                ],
              },
            ],

            // Main container that monitors installation
            containers: [
              {
                name: "kata-deploy-monitor",
                image: "quay.io/kata-containers/kata-deploy:latest",
                imagePullPolicy: "Always",
                command: ["/bin/bash", "-c", "/opt/kata-artifacts/scripts/kata-deploy.sh monitor"],
                env: [
                  {
                    name: "NODE_NAME",
                    valueFrom: {
                      fieldRef: {
                        fieldPath: "spec.nodeName",
                      },
                    },
                  },
                ],
                securityContext: {
                  privileged: true,
                },
                volumeMounts: [
                  {
                    name: "host-root",
                    mountPath: "/host",
                  },
                ],
              },
            ],

            // Volume mounts for host access
            volumes: [
              {
                name: "host-root",
                hostPath: {
                  path: "/",
                  type: "Directory",
                },
              },
              {
                name: "containerd-config",
                hostPath: {
                  path: "/etc/containerd",
                  type: "DirectoryOrCreate",
                },
              },
              {
                name: "kata-artifacts",
                emptyDir: {},
              },
            ],

            // Tolerations to run on all nodes
            tolerations: [
              {
                operator: "Exists",
              },
            ],
          },
        },
      },
    },
    {
      provider: homelab.kubernetesProvider,
      dependsOn: [serviceAccount, clusterRoleBinding],
    },
  );

  return kataDaemonSet;
}
