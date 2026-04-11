function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  /** Kubernetes namespace to watch for session pods */
  watchNamespace: process.env.WATCH_NAMESPACE ?? "opencode-router",
  /** Label selector identifying session pods */
  podLabelSelector:
    process.env.POD_LABEL_SELECTOR ?? "app.kubernetes.io/managed-by=opencode-router",
  /** Label key holding the 12-char hex session hash */
  sessionHashLabel: "opencode.ai/session-hash",
  /** Cloudflare API token (DNS:Edit + Zone:Read) */
  cfApiToken: required("CF_API_TOKEN"),
  /** Cloudflare Zone ID */
  cfZoneId: required("CF_ZONE_ID"),
  /** Cloudflare Tunnel ID */
  cfTunnelId: required("CF_TUNNEL_ID"),
  /** Base domain, e.g. "no-panic.org" */
  domain: required("DOMAIN"),
  /** Suffix appended to the hash, e.g. "-oc" → <hash>-oc.<domain> */
  routeSuffix: process.env.ROUTE_SUFFIX ?? "",
  /** In-cluster router service URL all session traffic is forwarded to */
  routerServiceUrl: required("ROUTER_SERVICE_URL"),
  /** Port for the health check HTTP server */
  healthPort: Number(process.env.HEALTH_PORT ?? 8080),
};

/** Compute the public hostname for a given session hash */
export function sessionHostname(hash: string): string {
  return `${hash}${config.routeSuffix}.${config.domain}`;
}
