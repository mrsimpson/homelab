import * as policy from "@pulumi/policy";

/**
 * Homelab Security and Best Practices Policy Pack
 *
 * Enforces security standards and best practices for homelab infrastructure.
 * Run with: pulumi preview --policy-pack policy/
 */

new policy.PolicyPack("homelab-policies", {
  policies: [
    // ========================================
    // TIER 1: SECURITY (MANDATORY)
    // ========================================

    {
      name: "ingress-requires-tls",
      description: "All Ingress resources must configure TLS for HTTPS",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:networking.k8s.io/v1:Ingress",
        (ingress, args, reportViolation) => {
          const tls = ingress.spec?.tls;
          if (!tls || tls.length === 0) {
            reportViolation(
              "Ingress must configure TLS. Add spec.tls with secretName and hosts."
            );
          }
        }
      ),
    },

    {
      name: "no-privileged-containers",
      description: "Containers cannot run in privileged mode",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const containers =
            deployment.spec?.template?.spec?.containers || [];
          containers.forEach((container) => {
            if (container.securityContext?.privileged === true) {
              reportViolation(
                `Container '${container.name}' cannot run as privileged. Set securityContext.privileged: false`
              );
            }
          });
        }
      ),
    },

    {
      name: "containers-must-run-as-non-root",
      description: "Containers must explicitly run as non-root user",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const podSecurityContext =
            deployment.spec?.template?.spec?.securityContext;
          const containers =
            deployment.spec?.template?.spec?.containers || [];

          // Check pod-level security context
          const podRunAsNonRoot = podSecurityContext?.runAsNonRoot;

          // If not set at pod level, check each container
          if (!podRunAsNonRoot) {
            containers.forEach((container) => {
              const containerRunAsNonRoot =
                container.securityContext?.runAsNonRoot;
              if (!containerRunAsNonRoot) {
                reportViolation(
                  `Container '${container.name}' must set securityContext.runAsNonRoot: true`
                );
              }
            });
          }
        }
      ),
    },

    {
      name: "no-host-network",
      description: "Pods cannot use host network namespace",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const hostNetwork = deployment.spec?.template?.spec?.hostNetwork;
          if (hostNetwork === true) {
            reportViolation(
              "Pod cannot use host network. Set spec.template.spec.hostNetwork: false or omit it."
            );
          }
        }
      ),
    },

    {
      name: "no-host-pid-ipc",
      description: "Pods cannot share host PID or IPC namespace",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const spec = deployment.spec?.template?.spec;
          if (spec?.hostPID === true) {
            reportViolation("Pod cannot use host PID namespace");
          }
          if (spec?.hostIPC === true) {
            reportViolation("Pod cannot use host IPC namespace");
          }
        }
      ),
    },

    {
      name: "resource-limits-required",
      description: "Containers must specify resource limits",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const containers =
            deployment.spec?.template?.spec?.containers || [];
          containers.forEach((container) => {
            const limits = container.resources?.limits;
            if (!limits || (!limits.cpu && !limits.memory)) {
              reportViolation(
                `Container '${container.name}' must specify resource limits (cpu and/or memory)`
              );
            }
          });
        }
      ),
    },

    // ========================================
    // TIER 2: AUTHENTICATION (CONDITIONAL)
    // ========================================

    {
      name: "sensitive-services-require-oauth",
      description:
        "Services tagged as 'sensitive' must have OAuth protection",
      enforcementLevel: "mandatory",
      validateResource: (args, reportViolation) => {
        // Check custom ExposedWebApp components
        if (args.type === "homelab:ExposedWebApp") {
          const tags = args.props.tags || [];
          const isSensitive = tags.includes("sensitive");
          const hasOAuth = args.props.oauth !== undefined;

          if (isSensitive && !hasOAuth) {
            reportViolation(
              `Service '${args.name}' is tagged as sensitive and must configure OAuth protection`
            );
          }
        }
      },
    },

    {
      name: "public-services-must-be-explicit",
      description:
        "Services exposed without OAuth must be tagged as 'public'",
      enforcementLevel: "advisory",
      validateResource: (args, reportViolation) => {
        if (args.type === "homelab:ExposedWebApp") {
          const tags = args.props.tags || [];
          const hasOAuth = args.props.oauth !== undefined;
          const isPublic = tags.includes("public");

          if (!hasOAuth && !isPublic) {
            reportViolation(
              `Service '${args.name}' has no OAuth protection and is not tagged as 'public'. ` +
                "Either add OAuth or tag with 'public' to acknowledge public access."
            );
          }
        }
      },
    },

    {
      name: "oauth-requires-valid-provider",
      description: "OAuth configuration must use supported provider",
      enforcementLevel: "mandatory",
      validateResource: (args, reportViolation) => {
        if (args.type === "homelab:ExposedWebApp" && args.props.oauth) {
          const validProviders = ["google", "github", "oidc"];
          const provider = args.props.oauth.provider;

          if (!validProviders.includes(provider)) {
            reportViolation(
              `OAuth provider '${provider}' is not supported. Use one of: ${validProviders.join(", ")}`
            );
          }
        }
      },
    },

    // ========================================
    // TIER 3: CLOUDFLARE TUNNEL
    // ========================================

    {
      name: "ingress-must-target-tunnel",
      description:
        "Ingress resources should use Cloudflare Tunnel for exposure",
      enforcementLevel: "advisory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:networking.k8s.io/v1:Ingress",
        (ingress, args, reportViolation) => {
          const annotations = ingress.metadata?.annotations || {};
          const hasTunnelTarget =
            annotations["external-dns.alpha.kubernetes.io/target"];

          if (!hasTunnelTarget) {
            reportViolation(
              "Ingress should set 'external-dns.alpha.kubernetes.io/target' annotation to point to Cloudflare Tunnel"
            );
          }
        }
      ),
    },

    // ========================================
    // TIER 4: STORAGE
    // ========================================

    {
      name: "pvc-must-specify-size",
      description: "PersistentVolumeClaims must specify storage size",
      enforcementLevel: "mandatory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:core/v1:PersistentVolumeClaim",
        (pvc, args, reportViolation) => {
          const storage = pvc.spec?.resources?.requests?.storage;
          if (!storage) {
            reportViolation(
              "PersistentVolumeClaim must specify spec.resources.requests.storage"
            );
          }
        }
      ),
    },

    {
      name: "pvc-uses-valid-storage-class",
      description: "PVCs should use approved storage classes",
      enforcementLevel: "advisory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:core/v1:PersistentVolumeClaim",
        (pvc, args, reportViolation) => {
          const validStorageClasses = ["nfs", "synology-nfs", "local-path"];
          const storageClass = pvc.spec?.storageClassName;

          if (
            storageClass &&
            !validStorageClasses.includes(storageClass)
          ) {
            reportViolation(
              `Storage class '${storageClass}' is not in approved list: ${validStorageClasses.join(", ")}`
            );
          }
        }
      ),
    },

    // ========================================
    // TIER 5: BEST PRACTICES
    // ========================================

    {
      name: "deployments-require-labels",
      description: "Deployments must have standard labels",
      enforcementLevel: "advisory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const labels = deployment.metadata?.labels || {};
          const requiredLabels = ["app", "environment"];

          requiredLabels.forEach((label) => {
            if (!labels[label]) {
              reportViolation(
                `Deployment should have '${label}' label for better tracking`
              );
            }
          });
        }
      ),
    },

    {
      name: "services-must-match-deployment-selector",
      description:
        "Service selectors should match Deployment labels",
      enforcementLevel: "advisory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:core/v1:Service",
        (service, args, reportViolation) => {
          const selector = service.spec?.selector;
          if (!selector || Object.keys(selector).length === 0) {
            reportViolation(
              "Service should have spec.selector to route traffic to pods"
            );
          }
        }
      ),
    },

    {
      name: "no-latest-image-tag",
      description: "Container images should use specific versions, not 'latest'",
      enforcementLevel: "advisory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:apps/v1:Deployment",
        (deployment, args, reportViolation) => {
          const containers =
            deployment.spec?.template?.spec?.containers || [];
          containers.forEach((container) => {
            if (container.image?.endsWith(":latest")) {
              reportViolation(
                `Container '${container.name}' uses ':latest' tag. Use specific version for reproducibility.`
              );
            }
          });
        }
      ),
    },

    {
      name: "naming-convention",
      description: "Resources should follow naming conventions",
      enforcementLevel: "advisory",
      validateResource: (args, reportViolation) => {
        const name = args.name;
        const validNameRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

        if (!validNameRegex.test(name)) {
          reportViolation(
            `Resource name '${name}' should be lowercase alphanumeric with hyphens`
          );
        }
      },
    },

    {
      name: "no-hardcoded-secrets",
      description: "Secrets should not be hardcoded in resources",
      enforcementLevel: "mandatory",
      validateResource: (args, reportViolation) => {
        const propsStr = JSON.stringify(args.props).toLowerCase();

        // Check for common secret patterns
        const secretPatterns = [
          /password\s*[:=]\s*["'][^"']+["']/i,
          /api_key\s*[:=]\s*["'][^"']+["']/i,
          /client_secret\s*[:=]\s*["'][^"']+["']/i,
        ];

        secretPatterns.forEach((pattern) => {
          if (pattern.test(propsStr)) {
            reportViolation(
              `Resource '${args.name}' may contain hardcoded secrets. Use Pulumi config secrets or Kubernetes Secrets instead.`
            );
          }
        });
      },
    },

    // ========================================
    // TIER 6: HOMELAB-SPECIFIC
    // ========================================

    {
      name: "cert-manager-cluster-issuer",
      description: "Ingress should use cert-manager for TLS certificates",
      enforcementLevel: "advisory",
      validateResource: policy.validateResourceOfType(
        "kubernetes:networking.k8s.io/v1:Ingress",
        (ingress, args, reportViolation) => {
          const annotations = ingress.metadata?.annotations || {};
          const hasClusterIssuer =
            annotations["cert-manager.io/cluster-issuer"];

          if (!hasClusterIssuer) {
            reportViolation(
              "Ingress should set 'cert-manager.io/cluster-issuer' annotation for automatic TLS certificate provisioning"
            );
          }
        }
      ),
    },

    {
      name: "resource-namespace",
      description:
        "Resources should be deployed to appropriate namespaces",
      enforcementLevel: "advisory",
      validateResource: (args, reportViolation) => {
        const namespace = args.props.metadata?.namespace || "default";
        const systemNamespaces = [
          "kube-system",
          "kube-public",
          "kube-node-lease",
        ];

        // Don't deploy apps to system namespaces
        if (
          systemNamespaces.includes(namespace) &&
          !args.type.includes("kubernetes:")
        ) {
          reportViolation(
            `Custom resources should not be deployed to system namespace '${namespace}'`
          );
        }
      },
    },
  ],
});
