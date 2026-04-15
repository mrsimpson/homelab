import * as k8s from "@pulumi/kubernetes";
import { groups } from "./groups";
import { oauth2ProxyNamespace } from "./namespace";

/**
 * OAuth2-Proxy Email Allowlist ConfigMaps
 *
 * Creates one ConfigMap per group containing an email allowlist.
 * The oauth2-proxy Chart mounts these as files for email-based access control.
 *
 * ConfigMap structure:
 * - name: oauth2-emails-{group}
 * - key: restricted_user_access (default used by oauth2-proxy Chart)
 * - value: newline-separated list of allowed email addresses
 */

const emailConfigMaps: Record<string, k8s.core.v1.ConfigMap> = {};

for (const [group, config] of Object.entries(groups)) {
  emailConfigMaps[group] = new k8s.core.v1.ConfigMap(
    `oauth2-emails-${group}`,
    {
      metadata: {
        name: `oauth2-emails-${group}`,
        namespace: oauth2ProxyNamespace.metadata.name,
      },
      data: {
        // Key name must match oauth2-proxy Chart default
        restricted_user_access: config.emails.join("\n"),
      },
    },
    {
      dependsOn: [oauth2ProxyNamespace],
    }
  );
}

export const configMaps = emailConfigMaps;
