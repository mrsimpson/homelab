import * as pulumi from "@pulumi/pulumi";
import { HomelabContext } from "./homelab-context";
import type {
  ExternalSecretsConfig,
  GatewayApiConfig,
  TLSConfig,
} from "./ExposedWebApp";

/**
 * Optional overrides for infrastructure configuration that cannot be derived
 * from StackReference outputs (e.g. live Pulumi resources, non-default names).
 *
 * All fields have sensible homelab defaults and may be omitted in most cases.
 */
export interface HomelabContextFromStackOptions {
  /**
   * TLS / cert-manager configuration.
   *
   * Defaults to `{ clusterIssuerName: "letsencrypt-prod" }` which matches the
   * name created by the homelab base-infra stack.
   */
  tls?: TLSConfig;

  /**
   * Gateway API / Traefik configuration.
   *
   * Defaults mirror the values set by the homelab base-infra stack:
   * - gatewayClass:           "traefik"
   * - gatewayName:            "homelab-gateway"
   * - gatewayNamespace:       "traefik-system"
   * - forwardAuthMiddleware:  "authelia-forwardauth"
   */
  gatewayApi?: GatewayApiConfig;

  /**
   * External Secrets Operator configuration.
   *
   * Defaults to `{ storeName: "pulumi-esc" }` which matches the
   * ClusterSecretStore created by the homelab base-infra stack.
   */
  externalSecrets?: ExternalSecretsConfig;
}

/**
 * Creates a {@link HomelabContext} by reading infrastructure facts from a
 * Pulumi StackReference to the homelab base stack.
 *
 * Use this in external repos instead of constructing HomelabContext manually.
 * It is the zero-boilerplate entry point for apps that live outside the
 * homelab monorepo.
 *
 * ## Required stack outputs
 *
 * The referenced stack must export:
 * - `tunnelCname`      — Cloudflare tunnel CNAME hostname (e.g. `<id>.cfargotunnel.com`)
 * - `cloudflareZoneId` — Cloudflare Zone ID for the homelab domain
 *
 * These are exported by `src/index.ts` in the homelab monorepo.
 *
 * ## Live resources (controller, clusterIssuer)
 *
 * `GatewayApiConfig.controller` and `TLSConfig.clusterIssuer` are live Pulumi
 * resource references and cannot be reconstructed from a StackReference.
 * They are intentionally omitted — ExposedWebApp works fine without them
 * (they only affect Pulumi's dependency graph, not the actual Kubernetes
 * resources that get created).  If you need explicit cross-stack dependencies,
 * pass a custom `options.gatewayApi` or `options.tls` object.
 *
 * @param stackRef - A Pulumi StackReference pointing to the homelab base stack.
 * @param options  - Optional overrides for TLS, Gateway API, and External
 *                   Secrets configuration.  Omit to use homelab defaults.
 * @returns A {@link HomelabContext} ready to use with `createExposedWebApp()`.
 *
 * @example
 * ```typescript
 * import * as pulumi from "@pulumi/pulumi";
 * import { createHomelabContextFromStack } from "@mrsimpson/homelab-core-components";
 *
 * const homelabStack = new pulumi.StackReference("org/homelab/prod");
 * const homelab = createHomelabContextFromStack(homelabStack);
 *
 * homelab.createExposedWebApp("my-app", {
 *   image: "my-org/my-app:latest",
 *   domain: pulumi.interpolate`my-app.${homelabStack.getOutput("domain")}`,
 *   port: 3000,
 * });
 * ```
 */
export function createHomelabContextFromStack(
  stackRef: pulumi.StackReference,
  options?: HomelabContextFromStackOptions
): HomelabContext {
  const tunnelCname = stackRef.getOutput("tunnelCname") as pulumi.Output<string>;
  const cloudflareZoneId = stackRef.getOutput("cloudflareZoneId") as pulumi.Output<string>;

  const tls: TLSConfig = options?.tls ?? {
    clusterIssuerName: "letsencrypt-prod",
  };

  const gatewayApi: GatewayApiConfig = options?.gatewayApi ?? {
    gatewayClass: "traefik",
    gatewayName: "homelab-gateway",
    gatewayNamespace: "traefik-system",
    forwardAuthMiddleware: "authelia-forwardauth",
  };

  const externalSecrets: ExternalSecretsConfig = options?.externalSecrets ?? {
    storeName: "pulumi-esc",
  };

  return new HomelabContext({
    cloudflare: {
      zoneId: cloudflareZoneId,
      tunnelCname,
    },
    tls,
    gatewayApi,
    externalSecrets,
  });
}
