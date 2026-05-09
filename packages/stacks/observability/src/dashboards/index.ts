import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";

export interface DashboardVolume {
  volume: object;
  volumeMount: object;
}

interface CommunityDashboard {
  id: number;
  name: string;
}

const COMMUNITY_DASHBOARDS: CommunityDashboard[] = [
  { id: 1860, name: "node-exporter-full" },
  { id: 15757, name: "k8s-views-global" },
  { id: 15760, name: "k8s-views-pods" },
  { id: 10229, name: "victoriametrics-single" },
];

async function fetchDashboardJson(id: number): Promise<string> {
  const url = `https://grafana.com/api/dashboards/${id}/revisions/latest/download`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch dashboard ${id}: ${res.status} ${res.statusText}`);
  }
  const dashboard = await res.json();
  // File-based provisioning expects raw dashboard JSON (no envelope)
  // Ensure the datasource references use the provisioned name
  return JSON.stringify(dashboard);
}

/**
 * Fetches community dashboards from grafana.com at deploy time and loads
 * custom dashboards from src/dashboards/json/. Returns ConfigMaps and
 * volume definitions for the Grafana pod.
 */
export function createDashboardConfigMaps(
  namespace: k8s.core.v1.Namespace,
): { configMaps: k8s.core.v1.ConfigMap[]; volumes: DashboardVolume[] } {
  const configMaps: k8s.core.v1.ConfigMap[] = [];
  const volumes: DashboardVolume[] = [];

  // Community dashboards — fetched from grafana.com at pulumi up time
  const communityData: Record<string, pulumi.Output<string>> = {};
  for (const dashboard of COMMUNITY_DASHBOARDS) {
    communityData[`${dashboard.name}.json`] = pulumi.output(
      fetchDashboardJson(dashboard.id),
    );
  }

  const communityCm = new k8s.core.v1.ConfigMap(
    "grafana-dashboards-community",
    {
      metadata: {
        name: "grafana-dashboards-community",
        namespace: "observability",
      },
      data: communityData,
    },
    { dependsOn: [namespace] },
  );
  configMaps.push(communityCm);
  volumes.push({
    volume: {
      name: "dashboards-community",
      configMap: { name: communityCm.metadata.name },
    },
    volumeMount: {
      name: "dashboards-community",
      mountPath: "/var/lib/grafana/dashboards/community",
    },
  });

  // Custom dashboards — loaded from local json/ directory
  const customDir = path.join(__dirname, "json");
  if (fs.existsSync(customDir)) {
    const files = fs.readdirSync(customDir).filter((f) => f.endsWith(".json"));
    if (files.length > 0) {
      const customData: Record<string, string> = {};
      for (const file of files) {
        customData[file] = fs.readFileSync(path.join(customDir, file), "utf-8");
      }

      const customCm = new k8s.core.v1.ConfigMap(
        "grafana-dashboards-custom",
        {
          metadata: {
            name: "grafana-dashboards-custom",
            namespace: "observability",
          },
          data: customData,
        },
        { dependsOn: [namespace] },
      );
      configMaps.push(customCm);
      volumes.push({
        volume: {
          name: "dashboards-custom",
          configMap: { name: customCm.metadata.name },
        },
        volumeMount: {
          name: "dashboards-custom",
          mountPath: "/var/lib/grafana/dashboards/custom",
        },
      });
    }
  }

  return { configMaps, volumes };
}
