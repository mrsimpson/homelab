import * as pulumi from "@pulumi/pulumi";
import { ExposedWebApp } from "../components/ExposedWebApp";
import { homelabConfig } from "../config";

/**
 * Hello World - Simple example application
 *
 * Demonstrates the basic usage of ExposedWebApp component.
 * Deploys a static nginx container with a custom HTML page.
 */

export const helloWorld = new ExposedWebApp("hello-world", {
	image: "nginxdemos/hello:latest",
	domain: pulumi.interpolate`hello.${homelabConfig.domain}`,
	port: 80,
	replicas: 1,
	resources: {
		requests: { cpu: "50m", memory: "64Mi" },
		limits: { cpu: "100m", memory: "128Mi" },
	},
	tags: ["example", "static"],
});

export const helloWorldUrl = pulumi.interpolate`https://hello.${homelabConfig.domain}`;
