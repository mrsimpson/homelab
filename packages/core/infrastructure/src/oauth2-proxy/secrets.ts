import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { oauth2ProxyNamespace } from "./namespace";

/**
 * oauth2-proxy GitHub OAuth Secret
 *
 * Stores shared GitHub OAuth App credentials used by all oauth2-proxy instances.
 * Referenced by all Helm releases.
 *
 * Credentials sourced from Pulumi config (encrypted in state file).
 */

const config = new pulumi.Config("oauth2-proxy");

export const oauth2ProxySecret = new k8s.core.v1.Secret(
  "oauth2-proxy-github-secret",
  {
    metadata: {
      name: "oauth2-proxy-github",
      namespace: oauth2ProxyNamespace.metadata.name,
    },
    type: "Opaque",
    stringData: {
      "client-id": config.requireSecret("clientId"),
      "client-secret": config.requireSecret("clientSecret"),
      "cookie-secret": config.requireSecret("cookieSecret"),
    },
  },
  {
    dependsOn: [oauth2ProxyNamespace],
  }
);

export const secretName = "oauth2-proxy-github";
