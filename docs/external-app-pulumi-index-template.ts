/**
 * External app deployment template for the homelab cluster.
 *
 * Copy this file to your app repo as the entrypoint for your Pulumi stack
 * (typically `src/index.ts` or `index.ts`, matching the `main` field in
 * your `Pulumi.yaml`).
 *
 * Prerequisites:
 *   npm install @pulumi/pulumi @pulumi/kubernetes @mrsimpson/homelab-core-components
 *
 * Required Pulumi config values (set via `pulumi config set`):
 *   image   — container image reference, e.g. ghcr.io/your-org/your-app:v1.2.3
 *
 * Required Pulumi ESC environment (add to Pulumi.<stack>.yaml):
 *   environment:
 *     - homelab/shared     # provides Cloudflare credentials etc.
 *
 * Required CI secrets:
 *   PULUMI_ACCESS_TOKEN   — Pulumi Cloud token (read/write access to this stack)
 *   KUBECONFIG            — kubeconfig scoped to your app's namespace
 */

import * as pulumi from "@pulumi/pulumi";
import { createHomelabContextFromStack, AuthType } from "@mrsimpson/homelab-core-components";

// ---------------------------------------------------------------------------
// 1. Reference the homelab base stack to get shared infrastructure outputs.
//
//    Format: "<org>/<project>/<stack>"
//    This must match the Pulumi Cloud URL of the homelab monorepo stack.
//    Tip: keep this in sync with HOMELAB_STACK in your Makefile.
// ---------------------------------------------------------------------------
const homelabStack = new pulumi.StackReference(
  process.env.HOMELAB_STACK ?? "mrsimpson/homelab/dev"
);

// ---------------------------------------------------------------------------
// 2. Build a HomelabContext from the stack reference.
//
//    createHomelabContextFromStack() reads tunnelCname and cloudflareZoneId
//    from the homelab stack outputs and applies homelab-standard defaults for:
//      - TLS:             clusterIssuerName = "letsencrypt-prod"
//      - Gateway API:     gatewayClass = "traefik", gatewayName = "homelab-gateway"
//      - ExternalSecrets: storeName = "pulumi-esc"
//
//    Pass a second argument (HomelabContextFromStackOptions) only if you need
//    to override those defaults — most apps can omit it entirely.
// ---------------------------------------------------------------------------
const homelab = createHomelabContextFromStack(homelabStack /*, {
  tls: { clusterIssuerName: "letsencrypt-staging" },   // override only if needed
  gatewayApi: { forwardAuthMiddleware: "my-custom-auth" },
  externalSecrets: { storeName: "my-store" },
} */);

// ---------------------------------------------------------------------------
// 3. Read app-specific config from this stack's Pulumi.<stack>.yaml.
//
//    Set these via: pulumi config set image ghcr.io/your-org/your-app:v1.2.3
// ---------------------------------------------------------------------------
const config = new pulumi.Config();

/** Container image to deploy (required — must be set in stack config). */
const image = config.require("image");

/**
 * Fully-qualified domain name for this app.
 *
 * Interpolates the `domain` output from the homelab stack so the subdomain
 * automatically follows the homelab base domain (e.g. "my-app.home.example.com").
 *
 * Alternatively hard-code a fixed domain:
 *   const domain = "my-app.home.example.com";
 */
const domain = pulumi.interpolate`my-app.${homelabStack.getOutput("domain")}`;

// ---------------------------------------------------------------------------
// 4. Deploy your app as an ExposedWebApp.
//
//    createExposedWebApp() creates the full Kubernetes resource set:
//      - Namespace
//      - Deployment + Service
//      - Gateway API HTTPRoute (or Traefik IngressRoute for OAUTH2_PROXY)
//      - Cloudflare DNS CNAME record
//      - TLS certificate (via cert-manager + Let's Encrypt)
//      - ExternalSecret(s) for any referenced ESC keys
//      - Optional: auth middleware (Authelia forward-auth or OAuth2-Proxy)
// ---------------------------------------------------------------------------
const myApp = homelab.createExposedWebApp("my-app", {
  // --- Required ---
  /** Container image reference. Use a specific tag in production; avoid "latest". */
  image,

  /** The FQDN that traffic will be routed to and that the TLS cert covers. */
  domain,

  /** The port your container listens on. */
  port: 8080,

  // --- Auth (pick one) ---
  //
  //   AuthType.NONE         — no auth, publicly accessible
  //   AuthType.FORWARD      — Authelia SSO via Traefik ForwardAuth middleware (default homelab SSO)
  //   AuthType.OAUTH2_PROXY — GitHub OAuth via the shared oauth2-proxy deployment
  //
  auth: AuthType.FORWARD,

  // --- Optional: app-specific config ---
  replicas: 1,

  /** Resource requests and limits (omit to use Kubernetes defaults). */
  resources: {
    requests: { cpu: "50m", memory: "64Mi" },
    limits:   { cpu: "200m", memory: "256Mi" },
  },

  /**
   * Environment variables injected into the container.
   * For secrets, reference an ESC key via an ExternalSecret instead of
   * putting plain-text values here.
   */
  env: [
    { name: "LOG_LEVEL", value: "info" },
    // { name: "API_KEY", value: mySecret.data["api-key"] },
  ],

  /**
   * Pull credentials for private registries (e.g. GHCR).
   * The referenced secret must exist in the app's namespace.
   * Typically provided via the homelab/shared ESC environment.
   */
  // imagePullSecrets: [{ name: "ghcr-credentials" }],

  /**
   * Persistent storage (omit for stateless apps).
   * The PVC is created in the app's namespace.
   */
  // storage: {
  //   size: "1Gi",
  //   mountPath: "/data",
  // },

  /** Labels applied to all resources — useful for filtering in dashboards. */
  tags: ["my-app"],
});

// ---------------------------------------------------------------------------
// 5. Stack outputs — exported values are visible in `pulumi stack output`
//    and can be read by other stacks via StackReference.
// ---------------------------------------------------------------------------

/** The public URL of this app (https://<domain>). */
export const url = pulumi.interpolate`https://${domain}`;

/** The Kubernetes namespace created for this app. */
export const namespace = myApp.namespace.metadata.name;
