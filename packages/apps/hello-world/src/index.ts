import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "@mrsimpson/homelab-config";
import type { HomelabContext, ExposedWebApp } from "@mrsimpson/homelab-core-components";

/**
 * Hello World - Simple example application
 *
 * Demonstrates the basic usage of homelab.createExposedWebApp().
 * Deploys a static nginx container with a custom HTML page.
 *
 * Usage:
 * import { createHelloWorld } from "@mrsimpson/homelab-app-hello-world";
 * const { app, url } = createHelloWorld(homelab);
 */

export function createHelloWorld(homelab: HomelabContext): { app: ExposedWebApp; url: pulumi.Output<string> } {
	const domain = pulumi.interpolate`hello.${homelabConfig.domain}`;

	const app = homelab.createExposedWebApp("hello-world", {
		image: "nginxinc/nginx-unprivileged:alpine",
		domain,
		port: 8080, // Unprivileged nginx runs on port 8080
		replicas: 1,
		resources: {
			requests: { cpu: "50m", memory: "64Mi" },
			limits: { cpu: "100m", memory: "128Mi" },
		},
		tags: ["example", "static"],
	});

	const url = pulumi.interpolate`https://${domain}`;

	return { app, url };
}
