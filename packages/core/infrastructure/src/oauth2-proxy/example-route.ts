import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";
import { homelabConfig } from "@mrsimpson/homelab-config";
import { tunnelCname } from "../cloudflare";
import { oauth2ProxyNamespace } from "./namespace";

/**
 * Example OAuth2-Proxy Protected Route
 *
 * Demonstrates the pattern for protecting an app with OAuth2-Proxy + Traefik:
 *
 * Uses IngressRoute (Traefik CRD) instead of Gateway API HTTPRoute because:
 * 1. IngressRoute supports cross-namespace service references directly
 * 2. IngressRoute has native Middleware CRD integration
 *
 * Authentication Flow:
 * 1. User visits protected app → ForwardAuth calls /oauth2/auth
 * 2. Not authenticated → 401 returned → needs to visit /oauth2/start
 * 3. User clicks sign-in link → /oauth2/start redirects to GitHub
 * 4. GitHub callback to oauth.no-panic.org/oauth2/callback
 * 5. oauth2-proxy creates session cookie, redirects to original URL
 * 6. Original URL now passes ForwardAuth (valid cookie) → app loads
 *
 * Note: The current implementation requires users to click a link when
 * unauthenticated. This is because Traefik ForwardAuth doesn't pass through
 * 302 redirects from the auth server.
 */

const domain = homelabConfig.domain;
const appHost = `oauth2-example.${domain}`;

// --- Namespace ---

export const exampleNamespace = new k8s.core.v1.Namespace("oauth2-example-ns", {
  metadata: {
    name: "oauth2-example",
    labels: { name: "oauth2-example" },
  },
});

// --- App deployment & service ---

export const exampleDeployment = new k8s.apps.v1.Deployment(
  "oauth2-example-app",
  {
    metadata: {
      name: "oauth2-example",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "oauth2-example" } },
      template: {
        metadata: { labels: { app: "oauth2-example" } },
        spec: {
          containers: [
            {
              name: "app",
              image: "nginxinc/nginx-unprivileged:alpine",
              ports: [{ containerPort: 8080 }],
              resources: {
                requests: { cpu: "10m", memory: "32Mi" },
                limits: { cpu: "50m", memory: "64Mi" },
              },
              volumeMounts: [
                { name: "tmp", mountPath: "/tmp" },
                { name: "var-cache", mountPath: "/var/cache/nginx" },
                { name: "var-run", mountPath: "/var/run" },
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: false,
                runAsNonRoot: true,
              },
            },
          ],
          volumes: [
            { name: "tmp", emptyDir: {} },
            { name: "var-cache", emptyDir: {} },
            { name: "var-run", emptyDir: {} },
          ],
        },
      },
    },
  },
  { dependsOn: [exampleNamespace] }
);

export const exampleService = new k8s.core.v1.Service(
  "oauth2-example-svc",
  {
    metadata: {
      name: "oauth2-example",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      selector: { app: "oauth2-example" },
      ports: [{ port: 80, targetPort: 8080 }],
      type: "ClusterIP",
    },
  },
  { dependsOn: [exampleDeployment] }
);

// --- ForwardAuth middleware using /oauth2/auth ---
// /oauth2/auth checks for session cookie:
// - If authenticated: returns 200 with X-Auth-Request-* headers
// - If not authenticated: returns 401
// IMPORTANT: Must forward Cookie header from browser to oauth2-proxy!

const forwardAuthMiddleware = new k8s.apiextensions.CustomResource(
  "oauth2-example-forwardauth",
  {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: "oauth2-forwardauth",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      forwardAuth: {
        // Use /oauth2/auth - returns 200 if session valid, 401 if not
        address: `http://oauth2-proxy-users.oauth2-proxy.svc.cluster.local/oauth2/auth`,
        trustForwardHeader: true,
        // Forward Cookie header from browser request to oauth2-proxy
        // Without this, oauth2-proxy won't see the session cookie!
        authRequestHeaders: ["Cookie", "Authorization"],
        // Headers from oauth2-proxy to forward to backend on 200
        authResponseHeaders: [
          "X-Auth-Request-User",
          "X-Auth-Request-Email",
          "X-Auth-Request-Groups",
          "Set-Cookie",
        ],
      },
    },
  },
  { dependsOn: [exampleNamespace] }
);

// --- Use shared redirect service from oauth2-proxy namespace ---
// This eliminates per-app ConfigMap + Deployment + Service (3 resources saved!)

// --- Errors middleware to handle 401 from ForwardAuth ---
// On 401, serves the shared redirect service which returns HTML with JS redirect
// The JS redirect goes to /oauth2/start which returns 302 to GitHub

const errorsMiddleware = new k8s.apiextensions.CustomResource(
  "oauth2-example-errors",
  {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: "oauth2-errors",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      errors: {
        status: ["401"],
        service: {
          name: "oauth2-shared-redirect",
          namespace: "oauth2-proxy",
          port: 80,
        },
        query: `/?rd=https://${appHost}{url}`,
      },
    },
  },
  { dependsOn: [exampleNamespace, oauth2ProxyNamespace] }
);

// --- Middleware chain: errors catches 401 from forwardauth ---

const middlewareChain = new k8s.apiextensions.CustomResource(
  "oauth2-example-chain",
  {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: "oauth2-chain",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      chain: {
        middlewares: [
          { name: "oauth2-errors", namespace: exampleNamespace.metadata.name },
          {
            name: "oauth2-forwardauth",
            namespace: exampleNamespace.metadata.name,
          },
        ],
      },
    },
  },
  { dependsOn: [errorsMiddleware, forwardAuthMiddleware] }
);

// --- IngressRoutes (Traefik CRD) ---
// Using IngressRoute instead of HTTPRoute for better cross-namespace support

// Route 1: /oauth2/* → oauth2-proxy (NO auth middleware)
// This handles sign-in, callback, and other oauth2-proxy endpoints
export const oauth2SignInRoute = new k8s.apiextensions.CustomResource(
  "oauth2-example-signin-route",
  {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: "oauth2-example-signin",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      // Use "web" entryPoint because Cloudflare Tunnel connects to Traefik HTTP port
      // (Cloudflare terminates TLS, so traffic arrives as HTTP)
      entryPoints: ["web"],
      routes: [
        {
          match: `Host(\`${appHost}\`) && PathPrefix(\`/oauth2/\`)`,
          kind: "Rule",
          services: [
            {
              name: "oauth2-proxy-users",
              namespace: oauth2ProxyNamespace.metadata.name,
              port: 80,
            },
          ],
        },
      ],
    },
  },
  { dependsOn: [exampleNamespace, oauth2ProxyNamespace] }
);

// Route 2: Everything else → app backend, protected by middleware chain
export const exampleRoute = new k8s.apiextensions.CustomResource(
  "oauth2-example-route",
  {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: {
      name: "oauth2-example",
      namespace: exampleNamespace.metadata.name,
    },
    spec: {
      // Use "web" entryPoint because Cloudflare Tunnel connects to Traefik HTTP port
      entryPoints: ["web"],
      routes: [
        {
          match: `Host(\`${appHost}\`)`,
          kind: "Rule",
          middlewares: [
            {
              name: "oauth2-chain",
              namespace: exampleNamespace.metadata.name,
            },
          ],
          services: [
            {
              name: "oauth2-example",
              port: 80,
            },
          ],
          // Lower priority than /oauth2/* route
          priority: 1,
        },
      ],
    },
  },
  { dependsOn: [exampleService, middlewareChain, oauth2SignInRoute] }
);

// --- DNS ---

export const exampleDnsRecord = new cloudflare.Record(
  "oauth2-example-dns",
  {
    zoneId: homelabConfig.cloudflare.zoneId,
    name: appHost,
    type: "CNAME",
    content: tunnelCname,
    proxied: true,
    comment: "Managed by Pulumi - oauth2-example (OAuth2-Proxy protected)",
  }
);

export const exampleAppHostname = appHost;
