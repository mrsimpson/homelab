import * as k8s from "@pulumi/kubernetes";
import { oauth2ProxyNamespace } from "./namespace";

/**
 * Shared OAuth2-Proxy Redirect Service
 *
 * This service handles 401 redirects for ALL apps using OAuth2-Proxy authentication.
 * Instead of creating a redirect service per app, we share one across the cluster.
 *
 * How it works:
 * 1. Traefik Errors middleware catches 401 from oauth2-proxy
 * 2. Redirects to this shared service with query params
 * 3. Nginx serves HTML with JavaScript redirect to /oauth2/start
 * 4. OAuth2-Proxy handles GitHub OAuth flow
 *
 * Savings: Eliminates ConfigMap + Deployment + Service per app
 */

// ConfigMap with nginx configuration for 401 redirect handling
export const redirectConfigMap = new k8s.core.v1.ConfigMap(
  "oauth2-shared-redirect-config",
  {
    metadata: {
      name: "oauth2-shared-redirect",
      namespace: oauth2ProxyNamespace.metadata.name,
    },
    data: {
      // Generic redirect handler - works for any domain including dynamic session subdomains.
      // Traefik errors middleware forwards the original client Host header to this service,
      // so $http_host always contains the actual hostname the user was trying to reach.
      // We use this to build the rd= URL dynamically instead of trusting the hardcoded
      // domain in the query param set by the errors middleware.
      "default.conf": `server {
    listen 8080;
    server_name _;
    
    location / {
        # Build rd= URL from the actual Host header so this works for both the main
        # app domain and any dynamic session subdomains (e.g. <hash>-oc.<domain>).
        # Traefik's errors middleware forwards the original Host by default, so
        # $http_host reflects the hostname the user was requesting - not this service.
        set $rd "https://$http_host$arg_url";
        
        default_type text/html;
        return 200 '<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0;url=/oauth2/start?rd=$rd">
    <script>window.location.href="/oauth2/start?rd=$rd";</script>
    <title>Redirecting to Sign In</title>
</head>
<body>
    <p>Redirecting to sign in...</p>
    <p><a href="/oauth2/start?rd=$rd">Click here if not redirected</a></p>
</body>
</html>';
    }
}`,
    },
  },
  { dependsOn: [oauth2ProxyNamespace] },
);

// Deployment - runs a single nginx pod to serve redirects
export const redirectDeployment = new k8s.apps.v1.Deployment(
  "oauth2-shared-redirect",
  {
    metadata: {
      name: "oauth2-shared-redirect",
      namespace: oauth2ProxyNamespace.metadata.name,
      labels: {
        app: "oauth2-shared-redirect",
        component: "authentication",
      },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "oauth2-shared-redirect" } },
      template: {
        metadata: {
          labels: { app: "oauth2-shared-redirect" },
          annotations: {
            "prometheus.io/scrape": "false", // No metrics needed
          },
        },
        spec: {
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 101, // nginx unprivileged user
            runAsGroup: 101,
            fsGroup: 101,
          },
          containers: [
            {
              name: "nginx",
              image: "nginxinc/nginx-unprivileged:alpine",
              ports: [{ containerPort: 8080, name: "http" }],
              resources: {
                requests: { cpu: "5m", memory: "16Mi" },
                limits: { cpu: "50m", memory: "32Mi" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: false,
                runAsNonRoot: true,
                capabilities: { drop: ["ALL"] },
                seccompProfile: { type: "RuntimeDefault" },
              },
              volumeMounts: [
                { name: "config", mountPath: "/etc/nginx/conf.d" },
                { name: "tmp", mountPath: "/tmp" },
                { name: "var-cache", mountPath: "/var/cache/nginx" },
                { name: "var-run", mountPath: "/var/run" },
              ],
              livenessProbe: {
                httpGet: { path: "/", port: 8080 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              readinessProbe: {
                httpGet: { path: "/", port: 8080 },
                initialDelaySeconds: 2,
                periodSeconds: 5,
              },
            },
          ],
          volumes: [
            { name: "config", configMap: { name: "oauth2-shared-redirect" } },
            { name: "tmp", emptyDir: {} },
            { name: "var-cache", emptyDir: {} },
            { name: "var-run", emptyDir: {} },
          ],
        },
      },
    },
  },
  { dependsOn: [redirectConfigMap] },
);

// Service - exposes redirect handler to Traefik
export const redirectService = new k8s.core.v1.Service(
  "oauth2-shared-redirect-svc",
  {
    metadata: {
      name: "oauth2-shared-redirect",
      namespace: oauth2ProxyNamespace.metadata.name,
      labels: {
        app: "oauth2-shared-redirect",
      },
    },
    spec: {
      type: "ClusterIP",
      selector: { app: "oauth2-shared-redirect" },
      ports: [
        {
          name: "http",
          port: 80,
          targetPort: 8080,
          protocol: "TCP",
        },
      ],
    },
  },
  { dependsOn: [redirectDeployment] },
);

// Export the service address for use in ExposedWebApp
export const redirectServiceAddress =
  "http://oauth2-shared-redirect.oauth2-proxy.svc.cluster.local";
