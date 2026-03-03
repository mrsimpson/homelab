import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import { tunnelCname } from "../cloudflare";
import { oauth2ProxyNamespace } from "./namespace";
import { releases } from "./oauth2-proxy";

/**
 * OAuth2-Proxy Callback HTTPRoute
 *
 * GitHub OAuth redirect endpoint (must be unprotected).
 * This route is referenced in the GitHub OAuth App configuration:
 * Authorization callback URL: https://oauth.no-panic.org/oauth2/callback
 *
 * Since all oauth2-proxy instances share the same GitHub OAuth App credentials,
 * any instance can handle the callback. The callback is forwarded based on
 * the cookie present in the request.
 */

const domain = homelabConfig.domain;
const callbackHost = `oauth.${domain}`;

// Reference first oauth2-proxy service for callback (any instance can handle it)
const firstGroup = Object.keys(releases)[0]!;
const firstRelease = releases[firstGroup]!;

export const callbackRoute = pulumi.all([firstRelease.name]).apply(([releaseName]) =>
  new k8s.apiextensions.CustomResource(
    "oauth2-callback-route",
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: {
        name: "oauth2-callback",
        namespace: oauth2ProxyNamespace.metadata.name,
      },
      spec: {
        parentRefs: [
          {
            name: "homelab-gateway",
            kind: "Gateway",
            namespace: "traefik-system",
          },
        ],
        hostnames: [callbackHost],
        rules: [
          {
            matches: [
              {
                path: {
                  type: "PathPrefix",
                  value: "/oauth2/callback",
                },
              },
            ],
            backendRefs: [
              {
                name: releaseName, // Use actual Helm release name which includes hash
                port: 80, // Service exposes container port 4180 as port 80
                namespace: oauth2ProxyNamespace.metadata.name,
              },
            ],
          },
        ],
      },
    },
    {
      dependsOn: Object.values(releases), // Wait for all oauth2-proxy deployments
    }
  )
);

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
