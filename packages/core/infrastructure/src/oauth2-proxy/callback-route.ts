import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import { tunnelCname } from "../cloudflare";
import { oauth2ProxyNamespace } from "./namespace";
import { releases } from "./oauth2-proxy";
import { groups } from "./groups";
import { callbackUrl } from "./helpers";

/**
 * OAuth2-Proxy Callback IngressRoute
 *
 * GitHub App redirect endpoints (must be unprotected).
 * Since the GitHub App supports multiple callback URLs, each group gets its
 * own dedicated callback path registered in the app:
 *
 *   users       → https://oauth.no-panic.org/oauth2/callback
 *   developers  → https://oauth.no-panic.org/developers/oauth2/callback
 *
 * Path-based routing is deterministic and eliminates the fragile CSRF-cookie
 * regex matching that was required with a single-callback OAuth App.
 *
 * oauth2-proxy strips the group-prefix before forwarding to its own handler
 * via the `--proxy-prefix` flag, so each instance sees a plain `/oauth2/…` path.
 */

const domain = homelabConfig.domain;
const callbackHost = `oauth.${domain}`;

// Determine default group (first entry — "users")
const defaultGroup = Object.keys(groups)[0]!;

// Collect all release names needed for routing
const groupEntries = Object.entries(groups);
const allReleaseNames = pulumi.all(
  groupEntries.map(([group]) => releases[group]!.name),
);

// StripPrefix middlewares for non-default groups — created eagerly (outside apply)
// so Pulumi can track them as discrete resources.
const stripMiddlewares: Record<string, k8s.apiextensions.CustomResource> = {};
for (const [group] of groupEntries) {
  if (group === defaultGroup) continue;
  stripMiddlewares[group] = new k8s.apiextensions.CustomResource(
    `oauth2-strip-${group}-prefix`,
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "Middleware",
      metadata: {
        name: `strip-${group}-prefix`,
        namespace: oauth2ProxyNamespace.metadata.name,
      },
      spec: {
        stripPrefix: {
          prefixes: [`/${group}`],
        },
      },
    },
    { dependsOn: Object.values(releases) },
  );
}

export const callbackRoute = allReleaseNames.apply((names) => {
  // Build routing rules: non-default groups use path-prefixed routes (higher
  // priority); the default group falls back to the root /oauth2/callback path.
  const routes: object[] = [];

  groupEntries.forEach(([group, _config], index) => {
    const releaseName = names[index]!;

    if (group === defaultGroup) return; // handled by fallback below

    // Non-default group: dedicated path, no cookie matching needed
    routes.push({
      match: `Host(\`${callbackHost}\`) && PathPrefix(\`/${group}/oauth2/callback\`)`,
      kind: "Rule",
      priority: 20,
      middlewares: [
        // Strip the group prefix so oauth2-proxy receives /oauth2/callback
        {
          name: `strip-${group}-prefix`,
          namespace: oauth2ProxyNamespace.metadata.name,
        },
      ],
      services: [
        {
          name: releaseName,
          namespace: oauth2ProxyNamespace.metadata.name,
          port: 80,
        },
      ],
    });
  });

  // Fallback rule — default group on the root /oauth2/callback path
  const defaultIndex = groupEntries.findIndex(([g]) => g === defaultGroup);
  const defaultReleaseName = names[defaultIndex]!;
  routes.push({
    match: `Host(\`${callbackHost}\`) && PathPrefix(\`/oauth2/callback\`)`,
    kind: "Rule",
    priority: 10,
    services: [
      {
        name: defaultReleaseName,
        namespace: oauth2ProxyNamespace.metadata.name,
        port: 80,
      },
    ],
  });

  return new k8s.apiextensions.CustomResource(
    "oauth2-callback-route",
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: {
        name: "oauth2-callback",
        namespace: oauth2ProxyNamespace.metadata.name,
      },
      spec: {
        entryPoints: ["web"],
        routes,
      },
    },
    {
      dependsOn: [
        ...Object.values(releases),
        ...Object.values(stripMiddlewares),
      ],
    },
  );
});

// Cloudflare DNS record for the callback host — required for GitHub redirect
export const callbackDnsRecord = new cloudflare.Record("oauth2-callback-dns", {
  zoneId: homelabConfig.cloudflare.zoneId,
  name: callbackHost,
  type: "CNAME",
  content: tunnelCname,
  proxied: true,
  comment: "Managed by Pulumi - oauth2-proxy callback (GitHub App redirect)",
});

export const callbackHostname = callbackHost;

/**
 * Registered GitHub App callback URLs (add all to the GitHub App settings):
 * https://oauth.{domain}/oauth2/callback          — users (default)
 * https://oauth.{domain}/developers/oauth2/callback — developers
 */
export const callbackUrls = Object.keys(groups).map((g) =>
  callbackUrl(g, domain),
);
