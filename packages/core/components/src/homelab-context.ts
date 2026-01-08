import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import type {
  CloudflareConfig,
  ExposedWebAppArgs,
  ExternalSecretsConfig,
  ForwardAuthConfig,
  IngressConfig,
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
  ingress?: IngressConfig;
  externalSecrets?: ExternalSecretsConfig;
  forwardAuth?: ForwardAuthConfig;
  namespaces?: Record<string, k8s.core.v1.Namespace>;
}

export class HomelabContext {
  constructor(private readonly config: HomelabContextConfig) {}

  /**
   * Creates an ExposedWebApp with infrastructure dependencies automatically injected
   */
  createExposedWebApp(
    name: string,
    args: Omit<
      ExposedWebAppArgs,
      "cloudflare" | "tls" | "ingress" | "externalSecrets" | "forwardAuth" | "namespace"
    >,
    opts?: pulumi.ComponentResourceOptions
  ): ExposedWebApp {
    // Check if a namespace was pre-created for this app
    const existingNamespace = this.config.namespaces?.[name];

    return new ExposedWebApp(
      name,
      {
        ...args,
        cloudflare: this.config.cloudflare,
        tls: this.config.tls,
        ingress: this.config.ingress,
        externalSecrets: this.config.externalSecrets,
        forwardAuth: this.config.forwardAuth,
        namespace: existingNamespace,
      },
      opts
    );
  }
}
