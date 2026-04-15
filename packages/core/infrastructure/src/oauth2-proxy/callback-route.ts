import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import { tunnelCname } from "../cloudflare";
import { oauth2ProxyNamespace } from "./namespace";
import { releases } from "./oauth2-proxy";
import { groups } from "./groups";

/**
 * OAuth2-Proxy Callback IngressRoute
 *
 * GitHub OAuth redirect endpoint (must be unprotected).
 * This route is referenced in the GitHub OAuth App configuration:
 * Authorization callback URL: https://oauth.no-panic.org/oauth2/callback
 *
 * Since all oauth2-proxy instances share the same GitHub OAuth App credentials,
 * callback routing is determined by the CSRF cookie present in the request.
 *
 * NOTE: Traefik v3.1 does not support RegularExpression header matching in
 * Gateway API HTTPRoutes (extended feature not implemented). We use the
 * Traefik-native IngressRoute CRD with HeaderRegexp() router rules instead,
 * which fully supports cookie-based regex matching.
 */

const domain = homelabConfig.domain;
const callbackHost = `oauth.${domain}`;

// Determine default group (first entry — "users")
const defaultGroup = Object.keys(groups)[0]!;

// Collect all release names needed for routing
const groupEntries = Object.entries(groups);
const allReleaseNames = pulumi.all(
  groupEntries.map(([group]) => releases[group]!.name)
);

export const callbackRoute = allReleaseNames.apply((names) => {
  // Build routing rules: specific (cookie-matched) groups first (higher priority), fallback last
  const routes: object[] = [];

  groupEntries.forEach(([group, config], index) => {
    const releaseName = names[index]!;

    if (config.scopes && config.scopes.length > 0) {
      // Non-default group: match on CSRF cookie using Traefik v3 HeaderRegexp
      routes.push({
        // cookie-csrf-per-request=true embeds a state hash in the name:
        // _oauth2_{group}_{hash}_csrf — so we match with a wildcard between group and _csrf
        match: `Host(\`${callbackHost}\`) && PathPrefix(\`/oauth2/callback\`) && HeaderRegexp(\`Cookie\`, \`.*_oauth2_${group}_.*_csrf.*\`)`,
        kind: "Rule",
        priority: 20,
        services: [
          {
            name: releaseName,
            namespace: oauth2ProxyNamespace.metadata.name,
            port: 80,
          },
        ],
      });
    }
  });

  // Fallback rule — default group, no cookie match required
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
      dependsOn: Object.values(releases),
    }
  );
});

// Cloudflare DNS record for the callback host — required for GitHub redirect
export const callbackDnsRecord = new cloudflare.Record(
  "oauth2-callback-dns",
  {
    zoneId: homelabConfig.cloudflare.zoneId,
    name: callbackHost,
    type: "CNAME",
    content: tunnelCname,
    proxied: true,
    comment: "Managed by Pulumi - oauth2-proxy callback (GitHub OAuth redirect)",
  }
);

export const callbackHostname = callbackHost;
