import * as pulumi from "@pulumi/pulumi";
import type {
	CloudflareConfig,
	ExposedWebAppArgs,
	ExternalSecretsConfig,
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
			"cloudflare" | "tls" | "ingress" | "externalSecrets"
		>,
		opts?: pulumi.ComponentResourceOptions,
	): ExposedWebApp {
		return new ExposedWebApp(
			name,
			{
				...args,
				cloudflare: this.config.cloudflare,
				tls: this.config.tls,
				ingress: this.config.ingress,
				externalSecrets: this.config.externalSecrets,
			},
			opts,
		);
	}
}
