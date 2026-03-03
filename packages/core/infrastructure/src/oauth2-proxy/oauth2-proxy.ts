import * as crypto from "crypto";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { groups } from "./groups";
import { oauth2ProxyNamespace } from "./namespace";
import { oauth2ProxySecret } from "./secrets";
import { configMaps } from "./email-configmaps";

/**
 * OAuth2-Proxy Helm Releases
 *
 * Deploys one oauth2-proxy instance per group with:
 * - Reference to shared GitHub OAuth credentials
 * - Group-specific email allowlist (ConfigMap)
 * - Unique cookie name per group
 * - Checksum annotation for automatic rollout on email changes
 *
 * Each instance is independent but shares:
 * - GitHub OAuth App (Client ID, Secret)
 * - Cookie domain
 * - Session duration settings
 */

const homelabConfig = new pulumi.Config("homelab");
const domain = homelabConfig.require("domain");

const helmReleases: Record<string, k8s.helm.v3.Release> = {};

for (const [group, emails] of Object.entries(groups)) {
  // Checksum of email content triggers pod restart when emails change
  const emailContent = emails.join("\n");
  const checksum = crypto
    .createHash("sha256")
    .update(emailContent)
    .digest("hex")
    .slice(0, 12);

  helmReleases[group] = new k8s.helm.v3.Release(
    `oauth2-proxy-${group}`,
    {
      chart: "oauth2-proxy",
      version: "7.12.x", // Stable version - pinned minor
      repositoryOpts: {
        repo: "https://oauth2-proxy.github.io/manifests",
      },
      namespace: oauth2ProxyNamespace.metadata.name,
      values: {
        // Use existing secret with GitHub credentials
        config: {
          existingSecret: "oauth2-proxy-github",
          // Override default config file to NOT include email_domains = ["*"]
          // which would bypass the authenticated-emails-file allowlist
          configFile: `upstreams = [ "file:///dev/null" ]`,
        },

        // Provider and authentication settings
        extraArgs: {
          provider: "github",
          // NOTE: Do NOT set "email-domain": "*" — it bypasses the email allowlist!
          // With authenticated-emails-file set, only listed emails are allowed.
          "redirect-url": `https://oauth.${domain}/oauth2/callback`, // GitHub OAuth callback URL
          "whitelist-domain": `.${domain}`, // Allow redirects to any subdomain
          "skip-provider-button": "true", // Skip sign-in page, redirect directly to GitHub
          "cookie-name": `_oauth2_${group}`, // Unique per group to avoid conflicts
          "cookie-domain": `.${domain}`, // Wildcard for all subdomains
          "cookie-secure": "true", // HTTPS only
          "cookie-httponly": "true", // No JavaScript access
          "cookie-samesite": "lax", // CSRF protection
          "cookie-expire": "168h", // 7-day session
          "cookie-refresh": "1h", // Refresh token hourly
          "set-xauthrequest": "true", // Set X-Auth-Request headers for downstream apps
          "reverse-proxy": "true", // Trust X-Forwarded headers from Traefik
          "pass-user-headers": "true", // Pass user headers to backend
        },

        // Email allowlist configuration
        authenticatedEmailsFile: {
          enabled: true,
          persistence: "configmap", // Mount ConfigMap as file
          template: `oauth2-emails-${group}`, // Reference group-specific ConfigMap
        },

        // Checksum annotation - triggers pod restart on email changes
        podAnnotations: {
          "checksum/emails": checksum,
        },

        // Minimal resource usage for homelab
        service: {
          type: "ClusterIP",
        },
        resources: {
          requests: {
            cpu: "10m",
            memory: "32Mi",
          },
          limits: {
            cpu: "100m",
            memory: "64Mi",
          },
        },
      },
    },
    {
      dependsOn: [oauth2ProxySecret, configMaps[group] as k8s.core.v1.ConfigMap],
    }
  );
}

export const releases = helmReleases;
