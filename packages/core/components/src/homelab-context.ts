import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import type {
  CloudflareConfig,
  ExposedWebAppArgs,
  ExternalSecretsConfig,
  GatewayApiConfig,
  TLSConfig,
} from "./ExposedWebApp";
import { ExposedWebApp } from "./ExposedWebApp";

/**
 * HomelabContext - Bundles all infrastructure dependencies for easy injection
 *
 * Create this once in your infrastructure setup, then use it to easily create
 * ExposedWebApp instances without needing to pass all dependencies every time.
 */
export interface HomelabContextConfig {
  cloudflare?: CloudflareConfig;
  tls?: TLSConfig;
  gatewayApi?: GatewayApiConfig;
  externalSecrets?: ExternalSecretsConfig;
  namespaces?: Record<string, k8s.core.v1.Namespace>;
}

export class HomelabContext {
  constructor(private readonly config: HomelabContextConfig) {}

  /**
   * Creates an ExposedWebApp with infrastructure dependencies automatically injected
   */
  createExposedWebApp(
    name: string,
    args: Omit<ExposedWebAppArgs, "cloudflare" | "tls" | "gatewayApi" | "externalSecrets">,
    opts?: pulumi.ComponentResourceOptions
  ): ExposedWebApp {
    return new ExposedWebApp(
      name,
      {
        ...args,
        cloudflare: this.config.cloudflare,
        tls: this.config.tls,
        gatewayApi: this.config.gatewayApi,
        externalSecrets: this.config.externalSecrets,
      },
      opts
    );
  }
}
