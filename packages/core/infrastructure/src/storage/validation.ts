import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

/**
 * Validates that the host system meets Longhorn requirements
 *
 * Creates a pre-check job that validates iSCSI tools are available
 * before Longhorn deployment proceeds.
 */

export function createLonghornPrecheck(
  namespace: pulumi.Output<string>,
  opts?: pulumi.ResourceOptions
): k8s.batch.v1.Job {
  return new k8s.batch.v1.Job(
    "longhorn-precheck",
    {
      metadata: {
        name: "longhorn-precheck",
        namespace: namespace,
        labels: {
          app: "longhorn-precheck",
          component: "validation",
        },
      },
      spec: {
        template: {
          spec: {
            restartPolicy: "Never",
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
            containers: [
              {
                name: "precheck",
                image: "alpine:latest",
                command: ["/bin/sh"],
                args: [
                  "-c",
                  `
                echo "🔍 Checking Longhorn prerequisites on host system..."
                
                # Check if iscsiadm is available on the host
                if nsenter --mount=/host/proc/1/ns/mnt which iscsiadm > /dev/null 2>&1; then
                  echo "✅ iscsiadm found on host system"
                else
                  echo "❌ ERROR: iscsiadm not found on host system"
                  echo ""
                  echo "Longhorn requires open-iscsi tools to be installed on the host."
                  echo ""
                  echo "Please install open-iscsi on your K3s node(s):"
                  echo ""
                  echo "  Ubuntu/Debian:"
                  echo "    sudo apt update && sudo apt install -y open-iscsi"
                  echo "    sudo systemctl enable --now iscsid"
                  echo ""
                  echo "  RHEL/CentOS/Fedora:"
                  echo "    sudo yum install -y iscsi-initiator-utils  # or dnf"
                  echo "    sudo systemctl enable --now iscsid"
                  echo ""
                  echo "After installation, re-run: pulumi up"
                  echo ""
                  exit 1
                fi
                
                # Check if iscsid service is running
                if nsenter --mount=/host/proc/1/ns/mnt --net=/host/proc/1/ns/net --pid=/host/proc/1/ns/pid systemctl is-active iscsid > /dev/null 2>&1; then
                  echo "✅ iscsid service is running on host system"
                else
                  echo "⚠️  WARNING: iscsid service may not be running"
                  echo "   You may need to run: sudo systemctl enable --now iscsid"
                fi
                
                echo ""
                echo "✅ Host system appears ready for Longhorn deployment"
                echo ""
                `,
                ],
                securityContext: {
                  privileged: true,
                },
                volumeMounts: [
                  {
                    name: "host-proc",
                    mountPath: "/host/proc",
                    readOnly: true,
                  },
                ],
              },
            ],
            volumes: [
              {
                name: "host-proc",
                hostPath: {
                  path: "/proc",
                },
              },
            ],
            hostNetwork: true,
            hostPID: true,
          },
        },
        backoffLimit: 1, // Don't retry on failure
        ttlSecondsAfterFinished: 600, // Clean up after 10 minutes
      },
    },
    opts
  );
}
