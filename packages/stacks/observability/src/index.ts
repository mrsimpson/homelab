/**
 * @mrsimpson/homelab-observability
 *
 * Lightweight observability stack:
 * - VictoriaMetrics (single-node) — Prometheus-compatible metrics backend
 * - prometheus-node-exporter    — host-level metrics (DaemonSet)
 * - kube-state-metrics          — Kubernetes object metrics
 * - Grafana                     — dashboards, datasource pre-configured
 *
 * Grafana is exposed via HomelabContext.createExposedWebApp (HTTPRoute +
 * Cloudflare DNS handled by the shared infrastructure layer).
 *
 * Set Grafana admin password before deploying:
 *   pulumi config set grafanaAdminPassword <password> --secret
 */

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import { HomelabContext } from "@mrsimpson/homelab-core-components";

const config = new pulumi.Config();
const grafanaAdminPassword = config.requireSecret("grafanaAdminPassword");

export interface ObservabilityArgs {
  homelab: HomelabContext;
  /** Storage class for VictoriaMetrics and Grafana PVCs (default: longhorn-uncritical) */
  storageClass?: string;
  /** Metrics retention period in months (default: "3") */
  retentionPeriod?: string;
  /** Storage size for VictoriaMetrics (default: "10Gi") */
  metricsStorageSize?: string;
}

export function setupObservability(args: ObservabilityArgs) {
  const storageClass = args.storageClass ?? "longhorn-uncritical";
  const retentionPeriod = args.retentionPeriod ?? "3";
  const metricsStorageSize = args.metricsStorageSize ?? "10Gi";

  // Namespace — privileged PSS required: node-exporter uses hostPID + hostNetwork
  const namespace = new k8s.core.v1.Namespace("observability-ns", {
    metadata: {
      name: "observability",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "baseline",
        "pod-security.kubernetes.io/warn": "baseline",
      },
    },
  });

  // node-exporter — host metrics from every node
  const nodeExporter = new k8s.helm.v3.Release(
    "node-exporter",
    {
      name: "node-exporter",
      chart: "prometheus-node-exporter",
      version: "4.55.0",
      namespace: "observability",
      repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
      },
      values: {
        // Annotate pods so VictoriaMetrics annotation-based discovery picks them up
        podAnnotations: {
          "prometheus.io/scrape": "true",
          "prometheus.io/port": "9100",
        },
        // Run on control-plane nodes too
        tolerations: [{ effect: "NoSchedule", operator: "Exists" }],
        resources: {
          requests: { cpu: "50m", memory: "32Mi" },
          limits: { cpu: "200m", memory: "64Mi" },
        },
      },
    },
    { dependsOn: [namespace] },
  );

  // kube-state-metrics — Kubernetes object metrics (Deployments, Pods, etc.)
  const kubeStateMetrics = new k8s.helm.v3.Release(
    "kube-state-metrics",
    {
      name: "kube-state-metrics",
      chart: "kube-state-metrics",
      version: "7.3.0",
      namespace: "observability",
      repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
      },
      values: {
        // Annotate service so VictoriaMetrics annotation-based discovery picks it up
        service: {
          annotations: {
            "prometheus.io/scrape": "true",
            "prometheus.io/port": "8080",
          },
        },
        resources: {
          requests: { cpu: "50m", memory: "64Mi" },
          limits: { cpu: "200m", memory: "128Mi" },
        },
      },
    },
    { dependsOn: [namespace] },
  );

  // VictoriaMetrics single-node
  // Service name produced by the chart: victoria-metrics-server (via fullnameOverride)
  const victoriaMetrics = new k8s.helm.v3.Release(
    "victoria-metrics",
    {
      name: "victoria-metrics",
      chart: "victoria-metrics-single",
      version: "0.37.0",
      namespace: "observability",
      repositoryOpts: {
        repo: "https://victoriametrics.github.io/helm-charts/",
      },
      values: {
        // Predictable service name for Grafana datasource URL
        fullnameOverride: "victoria-metrics",
        server: {
          retentionPeriod: retentionPeriod,
          persistentVolume: {
            enabled: true,
            size: metricsStorageSize,
            storageClass: storageClass,
          },
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: { cpu: "500m", memory: "512Mi" },
          },
          // Built-in Prometheus-compatible scraping via promscrape
          scrape: {
            enabled: true,
            config: {
              global: {
                scrape_interval: "30s",
              },
              scrape_configs: [
                // Pods annotated with prometheus.io/scrape=true (covers node-exporter)
                {
                  job_name: "kubernetes-pods",
                  kubernetes_sd_configs: [{ role: "pod" }],
                  relabel_configs: [
                    {
                      source_labels: [
                        "__meta_kubernetes_pod_annotation_prometheus_io_scrape",
                      ],
                      action: "keep",
                      regex: "true",
                    },
                    {
                      source_labels: [
                        "__meta_kubernetes_pod_annotation_prometheus_io_path",
                      ],
                      action: "replace",
                      target_label: "__metrics_path__",
                      regex: "(.+)",
                    },
                    {
                      source_labels: [
                        "__address__",
                        "__meta_kubernetes_pod_annotation_prometheus_io_port",
                      ],
                      action: "replace",
                      regex: "([^:]+)(?::\\d+)?;(\\d+)",
                      replacement: "$1:$2",
                      target_label: "__address__",
                    },
                    {
                      action: "labelmap",
                      regex: "__meta_kubernetes_pod_label_(.+)",
                    },
                    {
                      source_labels: ["__meta_kubernetes_namespace"],
                      target_label: "namespace",
                    },
                    {
                      source_labels: ["__meta_kubernetes_pod_name"],
                      target_label: "pod",
                    },
                  ],
                },
                // Services annotated with prometheus.io/scrape=true (covers kube-state-metrics)
                {
                  job_name: "kubernetes-services",
                  kubernetes_sd_configs: [{ role: "endpoints" }],
                  relabel_configs: [
                    {
                      source_labels: [
                        "__meta_kubernetes_service_annotation_prometheus_io_scrape",
                      ],
                      action: "keep",
                      regex: "true",
                    },
                    {
                      source_labels: [
                        "__address__",
                        "__meta_kubernetes_service_annotation_prometheus_io_port",
                      ],
                      action: "replace",
                      regex: "([^:]+)(?::\\d+)?;(\\d+)",
                      replacement: "$1:$2",
                      target_label: "__address__",
                    },
                    {
                      action: "labelmap",
                      regex: "__meta_kubernetes_service_label_(.+)",
                    },
                    {
                      source_labels: ["__meta_kubernetes_namespace"],
                      target_label: "namespace",
                    },
                    {
                      source_labels: ["__meta_kubernetes_service_name"],
                      target_label: "service",
                    },
                  ],
                },
                // kubelet metrics from each node
                {
                  job_name: "kubelet",
                  scheme: "https",
                  tls_config: { insecure_skip_verify: true },
                  bearer_token_file:
                    "/var/run/secrets/kubernetes.io/serviceaccount/token",
                  kubernetes_sd_configs: [{ role: "node" }],
                  relabel_configs: [
                    {
                      action: "labelmap",
                      regex: "__meta_kubernetes_node_label_(.+)",
                    },
                  ],
                },
                // cAdvisor — container resource metrics from each node
                {
                  job_name: "cadvisor",
                  scheme: "https",
                  tls_config: { insecure_skip_verify: true },
                  bearer_token_file:
                    "/var/run/secrets/kubernetes.io/serviceaccount/token",
                  kubernetes_sd_configs: [{ role: "node" }],
                  relabel_configs: [
                    {
                      action: "labelmap",
                      regex: "__meta_kubernetes_node_label_(.+)",
                    },
                    {
                      target_label: "__address__",
                      replacement: "kubernetes.default.svc:443",
                    },
                    {
                      source_labels: ["__meta_kubernetes_node_name"],
                      regex: "(.+)",
                      target_label: "__metrics_path__",
                      replacement: "/api/v1/nodes/$1/proxy/metrics/cadvisor",
                    },
                  ],
                },
              ],
            },
          },
        },
        // RBAC required for Kubernetes service discovery
        rbac: { create: true },
        serviceAccount: { create: true },
      },
    },
    { dependsOn: [namespace, nodeExporter, kubeStateMetrics] },
  );

  // Datasource provisioning file for Grafana
  const datasourceConfig = new k8s.core.v1.ConfigMap(
    "grafana-datasources",
    {
      metadata: {
        name: "grafana-datasources",
        namespace: "observability",
      },
      data: {
        "datasources.yaml": `apiVersion: 1
datasources:
  - name: VictoriaMetrics
    type: prometheus
    url: http://victoria-metrics-server.observability.svc.cluster.local:8428
    access: proxy
    isDefault: true
    jsonData:
      timeInterval: "30s"
`,
      },
    },
    { dependsOn: [namespace] },
  );

  // Grafana — routing delegated to HomelabContext (HTTPRoute + DNS via shared infra)
  const grafanaDomain = pulumi.interpolate`grafana.${homelabConfig.domain}`;
  const grafana = args.homelab.createExposedWebApp(
    "grafana",
    {
      namespace,
      image: "grafana/grafana:11.6",
      port: 3000,
      domain: grafanaDomain,
      storage: {
        size: "1Gi",
        mountPath: "/var/lib/grafana",
        storageClass,
      },
      env: [
        { name: "GF_SECURITY_ADMIN_PASSWORD", value: grafanaAdminPassword },
        { name: "GF_SERVER_ROOT_URL", value: pulumi.interpolate`https://${grafanaDomain}` },
      ],
      extraVolumes: [
        {
          name: "datasources",
          configMap: { name: datasourceConfig.metadata.name },
        },
      ],
      extraVolumeMounts: [
        {
          name: "datasources",
          mountPath: "/etc/grafana/provisioning/datasources",
        },
      ],
      securityContext: {
        runAsUser: 472,
        runAsGroup: 472,
        fsGroup: 472,
      },
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "256Mi" },
      },
    },
    { dependsOn: [victoriaMetrics, datasourceConfig] },
  );

  return {
    namespace,
    nodeExporter,
    kubeStateMetrics,
    victoriaMetrics,
    grafana,
    grafanaUrl: pulumi.interpolate`https://${grafanaDomain}`,
  };
}
