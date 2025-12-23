import { ExposedWebApp, type ExposedWebAppArgs } from "@mrsimpson/homelab-components";
import { homelabConfig } from "../config";
import { clusterIssuerName, letsEncryptIssuer } from "../core/cert-manager";
import { tunnelCname } from "../core/cloudflare";
import { externalSecretsOperator } from "../core/external-secrets";
import { ingressNginx } from "../core/ingress-nginx";

/**
 * Creates an ExposedWebApp with homelab infrastructure dependencies injected.
 *
 * This is a convenience wrapper that automatically provides:
 * - Cloudflare Zone ID and Tunnel CNAME
 * - Let's Encrypt ClusterIssuer for TLS
 * - Ingress-nginx controller
 * - External Secrets Operator for OAuth
 *
 * Example:
 *   createExposedWebApp("blog", {
 *     image: "ghost:5",
 *     domain: pulumi.interpolate`blog.${homelabConfig.domain}`,
 *     port: 2368
 *   });
 */
export function createExposedWebApp(
	name: string,
	args: Omit<ExposedWebAppArgs, "cloudflare" | "tls" | "ingress" | "externalSecrets">,
) {
	return new ExposedWebApp(name, {
		...args,
		cloudflare: {
			zoneId: homelabConfig.cloudflare.zoneId,
			tunnelCname: tunnelCname,
		},
		tls: {
			clusterIssuer: letsEncryptIssuer,
			clusterIssuerName: clusterIssuerName,
		},
		ingress: {
			controller: ingressNginx,
		},
		externalSecrets: {
			operator: externalSecretsOperator,
		},
	});
}
