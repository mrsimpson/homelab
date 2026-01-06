import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import { homelabConfig } from "@mrsimpson/homelab-config";

/**
 * Cloudflare Tunnel - Secure ingress without port forwarding
 *
 * Creates:
 * - Cloudflare Tunnel (persistent connection to Cloudflare)
 * - cloudflared deployment in Kubernetes
 * - Tunnel credentials as Kubernetes Secret
 */

// Generate tunnel secret
const tunnelSecret = new random.RandomPassword("tunnel-secret", {
  length: 32,
  special: false,
});

// Base64 encode the secret (required by Cloudflare)
const tunnelSecretBase64 = tunnelSecret.result.apply((s) => Buffer.from(s).toString("base64"));

// Create Cloudflare Tunnel
export const tunnel = new cloudflare.ZeroTrustTunnelCloudflared("homelab-tunnel", {
  accountId: homelabConfig.cloudflare.accountId,
  name: "homelab-k3s",
  secret: tunnelSecretBase64,
});

// Get tunnel token for cloudflared
export const tunnelToken = tunnel.tunnelToken;

// Export tunnel CNAME for DNS records
export const tunnelCname = tunnel.cname;

// Deploy cloudflared in Kubernetes
export const cloudflaredNamespace = new k8s.core.v1.Namespace("cloudflare", {
  metadata: {
    name: "cloudflare",
    labels: {
      "pod-security.kubernetes.io/enforce": "restricted",
      "pod-security.kubernetes.io/audit": "restricted",
      "pod-security.kubernetes.io/warn": "restricted",
    },
  },
});

// Create tunnel configuration
// This routes all traffic to the ingress-nginx controller
const tunnelConfig = new k8s.core.v1.ConfigMap(
  "tunnel-config",
  {
    metadata: {
      name: "tunnel-config",
      namespace: cloudflaredNamespace.metadata.name,
    },
    data: {
      "config.yaml": `tunnel: homelab-k3s
credentials-file: /etc/cloudflared/creds/credentials.json

# Route all traffic to ingress-nginx controller
# The ingress controller will handle hostname-based routing
ingress:
  - service: http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80
`,
    },
  },
  {
    dependsOn: [cloudflaredNamespace],
  }
);

// Store tunnel credentials as Secret
const tunnelCredsSecret = new k8s.core.v1.Secret(
  "tunnel-credentials",
  {
    metadata: {
      name: "tunnel-credentials",
      namespace: cloudflaredNamespace.metadata.name,
    },
    stringData: {
      "credentials.json": pulumi
        .all([tunnel.id, tunnelSecretBase64])
        .apply(([tunnelId, secret]: [string, string]) =>
          JSON.stringify({
            AccountTag: homelabConfig.cloudflare.accountId,
            TunnelSecret: secret,
            TunnelID: tunnelId,
          })
        ),
    },
  },
  {
    dependsOn: [cloudflaredNamespace, tunnel],
  }
);

// Deploy cloudflared daemon
export const cloudflaredDeployment = new k8s.apps.v1.Deployment(
  "cloudflared",
  {
    metadata: {
      name: "cloudflared",
      namespace: cloudflaredNamespace.metadata.name,
    },
    spec: {
      replicas: 2, // HA setup
      selector: {
        matchLabels: {
          app: "cloudflared",
        },
      },
      template: {
        metadata: {
          labels: {
            app: "cloudflared",
          },
        },
        spec: {
          // Security context for restricted Pod Security Standard
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65532, // nonroot user
            fsGroup: 65532,
            seccompProfile: {
              type: "RuntimeDefault",
            },
          },
          containers: [
            {
              name: "cloudflared",
              image: "cloudflare/cloudflared:2024.12.2",
              args: [
                "tunnel",
                "--no-autoupdate",
                "--metrics",
                "0.0.0.0:2000",
                "--config",
                "/etc/cloudflared/config/config.yaml",
                "run",
              ],
              volumeMounts: [
                {
                  name: "config",
                  mountPath: "/etc/cloudflared/config",
                  readOnly: true,
                },
                {
                  name: "creds",
                  mountPath: "/etc/cloudflared/creds",
                  readOnly: true,
                },
              ],
              // Container security context for restricted PSS
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsNonRoot: true,
                runAsUser: 65532,
                capabilities: {
                  drop: ["ALL"],
                },
                seccompProfile: {
                  type: "RuntimeDefault",
                },
              },
              livenessProbe: {
                httpGet: {
                  path: "/ready",
                  port: 2000,
                },
                initialDelaySeconds: 10,
                periodSeconds: 10,
              },
              resources: {
                requests: {
                  cpu: "50m",
                  memory: "64Mi",
                },
                limits: {
                  cpu: "200m",
                  memory: "256Mi",
                },
              },
            },
          ],
          volumes: [
            {
              name: "config",
              configMap: {
                name: tunnelConfig.metadata.name,
                items: [
                  {
                    key: "config.yaml",
                    path: "config.yaml",
                  },
                ],
              },
            },
            {
              name: "creds",
              secret: {
                secretName: tunnelCredsSecret.metadata.name,
              },
            },
          ],
        },
      },
    },
  },
  {
    dependsOn: [tunnelConfig, tunnelCredsSecret],
  }
);

// Export tunnel ID for creating routes
export const tunnelId = tunnel.id;
