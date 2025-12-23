import * as pulumi from "@pulumi/pulumi";
import { homelabConfig } from "../config";
import { homelab } from "../index";

/**
 * Hello World - Simple example application
 *
 * Demonstrates the basic usage of homelab.createExposedWebApp().
 * Deploys a static nginx container with a custom HTML page.
 */

export const helloWorld = homelab.createExposedWebApp("hello-world", {
	image: "nginxinc/nginx-unprivileged:alpine",
	domain: pulumi.interpolate`hello.${homelabConfig.domain}`,
	port: 8080, // Unprivileged nginx runs on port 8080
	replicas: 1,
	resources: {
		requests: { cpu: "50m", memory: "64Mi" },
		limits: { cpu: "100m", memory: "128Mi" },
	},
	tags: ["example", "static"],
});

export const helloWorldUrl = pulumi.interpolate`https://hello.${homelabConfig.domain}`;
