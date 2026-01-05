import { homelabConfig } from "@mrsimpson/homelab-config";
import type { ExposedWebApp, HomelabContext } from "@mrsimpson/homelab-core-components";
import * as pulumi from "@pulumi/pulumi";

/**
 * Secure Demo - Example application protected by Authelia forward authentication
 *
 * Demonstrates the forward-auth pattern with Authelia:
 * - No oauth2-proxy sidecar needed
 * - Authentication handled at ingress level
 * - Single sign-on across all homelab apps
 * - Access controlled via Authelia policies
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

    // Enable forward authentication
    // This will add nginx ingress annotations to forward auth checks to Authelia
    // The forwardAuth configuration is automatically injected from homelab context
    requireAuth: true,

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

    tags: ["example", "authenticated", "authelia"],
  });

  const url = pulumi.interpolate`https://${domain}`;

  return { app, url };
}
