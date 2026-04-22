import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { groups } from "./groups";
import {
  buildChecksum,
  buildEmailContent,
  buildHelmExtraArgs,
} from "./helpers";
import { oauth2ProxyNamespace } from "./namespace";
import { oauth2ProxySecret } from "./secrets";
import { configMaps } from "./email-configmaps";

/**
 * OAuth2-Proxy Helm Releases
 *
 * Deploys one oauth2-proxy instance per group with:
 * - Reference to GitHub OAuth credentials (shared or group-specific)
 * - Group-specific email allowlist (ConfigMap)
 * - Unique cookie name per group
 * - Checksum annotation for automatic rollout on email changes
 *
 * Groups with an `app` config get their own GitHub App credentials, allowing
 * each group to use a GitHub App with the appropriate permission set:
 *   users       — minimal app, user:email only
 *   developers  — elevated app, repo+workflow+gist write access
 */

const cfg = new pulumi.Config("oauth2-proxy");
const homelabConfig = new pulumi.Config("homelab");
const domain = homelabConfig.require("domain");

const helmReleases: Record<string, k8s.helm.v3.Release> = {};

for (const [group, config] of Object.entries(groups)) {
  const emailContent = buildEmailContent(config.emails);
  const checksum = buildChecksum(emailContent);

  // Use a dedicated secret when the group has its own GitHub App, otherwise
  // fall back to the shared secret.
  let secretName = "oauth2-proxy-github";
  const deps: pulumi.Resource[] = [
    oauth2ProxySecret,
    configMaps[group] as k8s.core.v1.ConfigMap,
  ];

  if (config.app) {
    const groupSecret = new k8s.core.v1.Secret(
      `oauth2-proxy-${group}-secret`,
      {
        metadata: {
          name: `oauth2-proxy-${group}`,
          namespace: oauth2ProxyNamespace.metadata.name,
        },
        type: "Opaque",
        stringData: {
          "client-id": cfg.requireSecret(config.app.clientIdKey),
          "client-secret": cfg.requireSecret(config.app.clientSecretKey),
          "cookie-secret": cfg.requireSecret(config.app.cookieSecretKey),
        },
      },
      { dependsOn: [oauth2ProxyNamespace] },
    );
    secretName = `oauth2-proxy-${group}`;
    deps.push(groupSecret);
  }

  helmReleases[group] = new k8s.helm.v3.Release(
    `oauth2-proxy-${group}`,
    {
      name: `oauth2-proxy-${group}`,
      chart: "oauth2-proxy",
      version: "7.12.x",
      repositoryOpts: {
        repo: "https://oauth2-proxy.github.io/manifests",
      },
      namespace: oauth2ProxyNamespace.metadata.name,
      values: {
        config: {
          existingSecret: secretName,
          configFile: `upstreams = [ "file:///dev/null" ]`,
        },
        extraArgs: buildHelmExtraArgs(group, config, domain),
        authenticatedEmailsFile: {
          enabled: true,
          persistence: "configmap",
          template: `oauth2-emails-${group}`,
        },
        podAnnotations: {
          "checksum/emails": checksum,
        },
        service: {
          type: "ClusterIP",
        },
        resources: {
          requests: { cpu: "10m", memory: "32Mi" },
          limits: { cpu: "100m", memory: "64Mi" },
        },
      },
    },
    { dependsOn: deps },
  );
}

export const releases = helmReleases;
