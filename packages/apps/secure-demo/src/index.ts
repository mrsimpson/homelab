import { homelabConfig } from "@mrsimpson/homelab-config";
import {
  AuthType,
  type ExposedWebApp,
  type HomelabContext,
} from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

/**
 * Secure Demo - Example application protected by Authelia forward authentication via Gateway API
 *
 * Demonstrates the forward-auth pattern with Authelia using Traefik Gateway API:
 * - No oauth2-proxy sidecar needed
 * - Authentication handled at HTTPRoute level via ForwardAuth middleware
 * - Single sign-on across all homelab apps
 * - Access controlled via Authelia policies
 * - Resolves HTTP scheme compatibility issues with Authelia v4.38.0
 *
 * This is a simple nginx server that displays authentication headers
 * forwarded by Authelia, showing the logged-in user's information.
 *
 * Usage:
 * import { createSecureDemo } from "@mrsimpson/homelab-app-secure-demo";
 * const { app, url } = createSecureDemo(homelab);
 */

export function createSecureDemo(homelab: HomelabContext): {
  app: ExposedWebApp;
  url: pulumi.Output<string>;
} {
  const domain = pulumi.interpolate`secure-demo.${homelabConfig.domain}`;

  const app = homelab.createExposedWebApp("secure-demo", {
    // Use a simple nginx image that can display request headers
    image: "nginxinc/nginx-unprivileged:alpine",
    domain,
    port: 8080,
    replicas: 2, // High availability - match nodejs-demo

    // Enable Authelia forward authentication via Gateway API
    // This will create HTTPRoute with ForwardAuth middleware reference
    auth: AuthType.FORWARD,

    resources: {
      requests: { cpu: "50m", memory: "64Mi" },
      limits: { cpu: "100m", memory: "128Mi" },
    },

    // Environment variables to demonstrate that the app receives auth headers
    env: [
      {
        name: "NGINX_ENTRYPOINT_QUIET_LOGS",
        value: "1",
      },
    ],

    tags: ["example", "authenticated", "authelia", "gateway-api"],
  });

  const url = pulumi.interpolate`https://${domain}`;

  return { app, url };
}
