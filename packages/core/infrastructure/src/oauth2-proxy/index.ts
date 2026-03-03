/**
 * oauth2-proxy infrastructure module
 *
 * Exports all OAuth2-Proxy components for integration into base infrastructure.
 *
 * Components:
 * - Namespace: Dedicated oauth2-proxy namespace
 * - Secrets: GitHub OAuth App credentials
 * - Email ConfigMaps: Group-based allowlists
 * - Helm Releases: Per-group oauth2-proxy instances
 * - Callback HTTPRoute: OAuth redirect endpoint
 * - Shared Redirect Service: Handles 401 redirects for all apps
 * - Example Protected Route: Reference implementation for OAuth2-Proxy protection
 */

export { oauth2ProxyNamespace, namespaceName } from "./namespace";
export { oauth2ProxySecret, secretName } from "./secrets";
export { groups } from "./groups";
export { configMaps } from "./email-configmaps";
export { releases } from "./oauth2-proxy";

export { callbackRoute, callbackDnsRecord, callbackHostname } from "./callback-route";
export {
  redirectConfigMap,
  redirectDeployment,
  redirectService,
  redirectServiceAddress,
} from "./shared-redirect";
export {
  exampleNamespace,
  exampleDeployment,
  exampleService,
  exampleRoute,
  oauth2SignInRoute,
  exampleDnsRecord,
  exampleAppHostname,
} from "./example-route";
