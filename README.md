# Secure Homelab Infrastructure

A type-safe, programmatic Infrastructure-as-Code homelab running on k3s with Pulumi and security-first principles.

## Why This Architecture?

This homelab is built with several key decisions based on security, maintainability, and modern DevOps practices:

### **Exposure Strategy: Cloudflare Tunnel**
- ✅ **No inbound ports** on home router (outbound-only connections)
- ✅ **Eliminates port scanning attacks** - homelab invisible to internet scanners
- ✅ **Works behind CGNAT** - no public IP required
- ✅ **Enterprise DDoS protection** - Cloudflare's 100+ Tbps mitigation
- ✅ **Automatic TLS** - certificates managed at edge
- ⚠️ **Trade-off**: Cloudflare can see traffic (acceptable for non-sensitive public services)

**Alternative considered**: Tailscale Funnel (end-to-end encrypted but limited to `.ts.net` domains)

### **Runtime: k3s (Lightweight Kubernetes)**
- ✅ **Production-grade orchestration** for homelab scale
- ✅ **Declarative service definitions** - infrastructure as code native
- ✅ **Extensible** - custom operators possible in future
- ✅ **Resource efficient** - runs on modest hardware

### **IaC: Pulumi with TypeScript**
- ✅ **Type safety** - IDE autocomplete, compile-time validation
- ✅ **Real programming language** - loops, functions, classes, packages
- ✅ **Reusable components** - define patterns once, use everywhere
- ✅ **Testable** - unit tests for infrastructure
- ✅ **One tool for everything** - k3s bootstrap + Kubernetes resources + cloud integrations
- ✅ **Better than YAML** - no templating hell, proper abstractions

**Alternatives considered**:
- CDK8s (Kubernetes-only, generates YAML)
- Timoni (CUE-based, smaller ecosystem)
- Traditional Helm/Kustomize (verbose, error-prone YAML)

### **Storage: Synology NFS via CSI**
- ✅ **Isolated from internet** - only accessible from k3s cluster
- ✅ **Dynamic provisioning** - PVCs automatically create NFS shares
- ✅ **Existing hardware** - leverage NAS investment
- ✅ **Automatic backups** - Synology's native backup tools

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Internet Users                                           │
└──────────────────────────────────────────────────────────┘
                          ↓ HTTPS
┌──────────────────────────────────────────────────────────┐
│  Cloudflare Edge (Global Network)                        │
├──────────────────────────────────────────────────────────┤
│  ✓ TLS termination                                       │
│  ✓ DDoS protection                                       │
│  ✓ WAF / Rate limiting                                   │
│  ✓ Optional: Cloudflare Access (SSO/2FA)                 │
└──────────────────────────────────────────────────────────┘
                          ↓ Encrypted Tunnel (outbound-only)
┌──────────────────────────────────────────────────────────┐
│  Home Network (No inbound ports open)                    │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌────────────────────────────────────────────────┐      │
│  │  k3s Cluster                                   │      │
│  ├────────────────────────────────────────────────┤      │
│  │                                                │      │
│  │  ┌──────────────────────────────────────┐     │      │
│  │  │  cloudflared (Tunnel Agent)          │     │      │
│  │  │  - Maintains outbound connections    │     │      │
│  │  │  - Auto-configured by Pulumi         │     │      │
│  │  └──────────────────────────────────────┘     │      │
│  │                    ↓                           │      │
│  │  ┌──────────────────────────────────────┐     │      │
│  │  │  ingress-nginx                       │     │      │
│  │  │  - Internal routing                  │     │      │
│  │  │  - Host-based routing                │     │      │
│  │  └──────────────────────────────────────┘     │      │
│  │                    ↓                           │      │
│  │  ┌──────────────────────────────────────┐     │      │
│  │  │  Application Pods                    │     │      │
│  │  │                                      │     │      │
│  │  │  ┌────────────┬──────────────┐      │     │      │
│  │  │  │ OAuth      │ Web App      │      │     │      │
│  │  │  │ Proxy      │ Container    │      │     │      │
│  │  │  │ (sidecar)  │              │      │     │      │
│  │  │  │            │              │      │     │      │
│  │  │  │ :4180 ───→ │ :8080        │      │     │      │
│  │  │  └────────────┴──────────────┘      │     │      │
│  │  │       ↓ (if storage needed)         │     │      │
│  │  │  PersistentVolumeClaim              │     │      │
│  │  └──────────────────────────────────────┘     │      │
│  │                    ↓                           │      │
│  │  ┌──────────────────────────────────────┐     │      │
│  │  │  democratic-csi (CSI Driver)         │     │      │
│  │  └──────────────────────────────────────┘     │      │
│  │                    ↓ NFS mount                 │      │
│  └────────────────────────────────────────────────┘      │
│                       ↓                                   │
│  ┌────────────────────────────────────────────────┐      │
│  │  Synology NAS                                  │      │
│  │  - NFS server (isolated, internal network)     │      │
│  │  - Dynamic share provisioning                  │      │
│  │  - Automated backups                           │      │
│  └────────────────────────────────────────────────┘      │
│                                                           │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Admin Access (separate from public exposure)            │
├──────────────────────────────────────────────────────────┤
│  Tailscale VPN (optional)                                │
│  - Subnet router mode for full cluster access            │
│  - End-to-end encrypted                                  │
│  - No Cloudflare visibility                              │
└──────────────────────────────────────────────────────────┘
```

---

## Design Principles

1. **Type-Safe Infrastructure** - Pulumi + TypeScript prevents misconfigurations at compile time
2. **Security First** - Defense in depth, no direct internet exposure, least privilege
3. **Programmatic, Not Declarative** - Real code with functions, loops, tests - not YAML
4. **Component-Based** - Reusable patterns (ExposedWebApp, Database, etc.)
5. **Isolation** - Network segmentation, Synology isolated from internet
6. **Reproducible** - Entire stack defined in code, destroy and rebuild anytime

---

## Directory Structure

```
homelab/
├── infrastructure/              # Pulumi TypeScript project
│   ├── src/
│   │   ├── components/          # Reusable infrastructure components
│   │   │   ├── ExposedWebApp.ts    # Web app with optional OAuth sidecar
│   │   │   ├── Database.ts         # PostgreSQL/MySQL with Synology storage
│   │   │   ├── CronJob.ts          # Scheduled tasks
│   │   │   └── StatefulService.ts  # Generic stateful workload
│   │   │
│   │   ├── core/                # Core cluster infrastructure
│   │   │   ├── k3s.ts              # k3s installation (bootstrap)
│   │   │   ├── cert-manager.ts     # TLS certificate management
│   │   │   ├── ingress-nginx.ts    # Ingress controller
│   │   │   ├── external-dns.ts     # DNS automation
│   │   │   ├── democratic-csi.ts   # Synology CSI driver
│   │   │   ├── cloudflare.ts       # Cloudflare Tunnel setup
│   │   │   └── tailscale.ts        # Optional: Tailscale VPN
│   │   │
│   │   ├── platform/            # Platform services
│   │   │   ├── monitoring.ts       # Prometheus + Grafana
│   │   │   └── secrets.ts          # External Secrets Operator
│   │   │
│   │   ├── apps/                # Application definitions
│   │   │   ├── blog.ts             # Example: Ghost blog
│   │   │   ├── dashboard.ts        # Example: Grafana with OAuth
│   │   │   └── home-assistant.ts   # Example: Home automation
│   │   │
│   │   ├── config.ts            # Configuration and secrets
│   │   └── index.ts             # Main entry point (orchestrates everything)
│   │
│   ├── package.json             # Node.js dependencies
│   ├── tsconfig.json            # TypeScript configuration
│   ├── Pulumi.yaml              # Pulumi project definition
│   └── Pulumi.dev.yaml          # Environment-specific config (gitignored)
│
├── bootstrap/                   # One-time setup scripts
│   ├── install-k3s.sh           # k3s installation script
│   └── install-pulumi.sh        # Pulumi CLI installation
│
├── scripts/                     # Helper utilities
│   ├── deploy.sh                # Deploy infrastructure
│   ├── destroy.sh               # Tear down (with confirmation)
│   └── update-app.sh            # Update specific application
│
├── docs/                        # Documentation
│   ├── SETUP.md                 # Initial setup guide
│   ├── COMPONENTS.md            # Component documentation
│   ├── SYNOLOGY.md              # Synology NFS configuration
│   └── TROUBLESHOOTING.md       # Common issues
│
├── .gitignore                   # Ignore secrets and local state
└── README.md                    # This file
```

---

## Component Pattern: ExposedWebApp

The core abstraction for exposing web applications with optional OAuth protection:

### **Usage Example**

```typescript
import { ExposedWebApp } from "./components/ExposedWebApp";

// Simple public blog
const blog = new ExposedWebApp("blog", {
  image: "ghost:latest",
  domain: "blog.example.com",
  port: 2368,
  storage: {
    size: "10Gi",
    mountPath: "/var/lib/ghost/content"
  }
});

// Protected admin dashboard with OAuth
const grafana = new ExposedWebApp("grafana", {
  image: "grafana/grafana:latest",
  domain: "grafana.example.com",
  port: 3000,
  oauth: {
    provider: "google",
    clientId: "xxx.apps.googleusercontent.com",
    clientSecret: config.requireSecret("grafanaOAuthSecret"),
    allowedEmails: ["admin@example.com"]
  },
  storage: {
    size: "5Gi",
    mountPath: "/var/lib/grafana"
  }
});

// Home Assistant with GitHub OAuth
const homeAssistant = new ExposedWebApp("home-assistant", {
  image: "homeassistant/home-assistant:latest",
  domain: "home.example.com",
  port: 8123,
  oauth: {
    provider: "github",
    clientId: "github-oauth-client-id",
    clientSecret: config.requireSecret("homeAssistantOAuthSecret"),
    allowedOrgs: ["my-family"]
  },
  storage: {
    size: "20Gi",
    mountPath: "/config"
  }
});
```

### **What Happens Automatically**

When you instantiate `ExposedWebApp`, Pulumi creates:

1. **Kubernetes Deployment**
   - Main application container
   - Optional OAuth2 Proxy sidecar (if `oauth` is specified)
   - Resource limits and security context (non-root)

2. **Kubernetes Service**
   - ClusterIP service
   - Routes to OAuth proxy port (4180) or app port directly

3. **PersistentVolumeClaim** (if `storage` specified)
   - Uses `synology-nfs` StorageClass
   - CSI driver creates NFS share on Synology
   - Automatically mounted to specified path

4. **Ingress Resource**
   - Host-based routing
   - Annotations for cert-manager (TLS certificates)
   - Annotations for external-dns (DNS records)

5. **Cloudflare Tunnel Route**
   - Automatic route configuration
   - Points `domain` to tunnel endpoint

6. **TLS Certificate**
   - cert-manager requests from Let's Encrypt
   - Automatically renewed

---

## OAuth Sidecar Pattern

When `oauth` is configured, the component deploys an OAuth2 Proxy sidecar:

```typescript
// Simplified implementation
containers: [
  {
    name: "oauth-proxy",
    image: "quay.io/oauth2-proxy/oauth2-proxy:v7.5.0",
    args: [
      `--upstream=http://localhost:${args.port}`,  // Proxy to app
      "--http-address=0.0.0.0:4180",
      `--provider=${args.oauth.provider}`,
      "--email-domain=*",
      "--cookie-secure=true",
      "--cookie-secret=...",
    ],
    ports: [{ containerPort: 4180 }],
    env: [
      { name: "OAUTH2_PROXY_CLIENT_ID", value: args.oauth.clientId },
      { name: "OAUTH2_PROXY_CLIENT_SECRET", valueFrom: secretRef }
    ]
  },
  {
    name: "app",
    image: args.image,
    ports: [{ containerPort: args.port }]
    // App listens on localhost - only accessible via OAuth proxy
  }
]
```

**Security benefits:**
- ✅ Application never directly exposed (even within cluster)
- ✅ Sidecar shares Pod network namespace (`localhost` communication)
- ✅ OAuth provider validates identity (Google, GitHub, OIDC, etc.)
- ✅ Can restrict by email, domain, or organization
- ✅ Session cookies for persistent auth

**Supported providers:**
- Google (workspace or consumer accounts)
- GitHub (can restrict by organization)
- GitLab
- OIDC (generic, e.g., Keycloak, Authentik)
- Azure AD, Okta, Auth0, etc.

---

## How Exposure Works

### **Traffic Flow**

1. **User visits `app.example.com`**
2. **DNS** resolves to Cloudflare edge (configured by external-dns)
3. **Cloudflare edge** routes to tunnel endpoint
4. **cloudflared** (running in cluster) receives request
5. **Ingress controller** routes based on Host header
6. **Service** forwards to Pod
7. **OAuth Proxy** (if configured) validates authentication
8. **Application container** serves response

### **Automatic Configuration**

Pulumi orchestrates:
- ✅ Cloudflare Tunnel creation (one tunnel for all services)
- ✅ DNS CNAME records (`app.example.com` → `tunnel-id.cfargotunnel.com`)
- ✅ Tunnel route configuration (hostname → Ingress)
- ✅ TLS certificates from Let's Encrypt
- ✅ Ingress rules for host-based routing

### **No Manual Steps**

Just define the component in TypeScript and run:
```bash
pulumi up
```

Everything is provisioned, configured, and deployed automatically.

---

## Storage Integration (Synology)

### **How It Works**

1. **democratic-csi** driver deployed in cluster (via Pulumi)
2. **StorageClass** `synology-nfs` configured with Synology API credentials
3. **Component requests PVC** with `storageClassName: synology-nfs`
4. **CSI driver** creates NFS share on Synology (e.g., `/volume1/k3s/pvc-abc123`)
5. **kubelet** mounts share to Pod
6. **Application** writes to mount path, data persists on Synology

### **Security**

- ✅ Synology NFS only accessible from k3s nodes (firewall rules)
- ✅ Each PVC gets isolated directory
- ✅ Synology snapshots/backups protect data
- ✅ No direct internet exposure of NAS

### **Example PVC in Component**

```typescript
if (args.storage) {
  const pvc = new k8s.core.v1.PersistentVolumeClaim(`${name}-data`, {
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "synology-nfs",
      resources: {
        requests: { storage: args.storage.size }
      }
    }
  }, { parent: this });

  // Mount to deployment
  volumes.push({ name: "data", persistentVolumeClaim: { claimName: pvc.metadata.name } });
  volumeMounts.push({ name: "data", mountPath: args.storage.mountPath });
}
```

---

## Security Features

### **Network Security**
- ✅ **No inbound ports** on home router/firewall
- ✅ **Outbound-only tunnel** eliminates port scanning attacks
- ✅ **Network policies** between namespaces (future)
- ✅ **Synology isolated** - only accessible from k3s nodes

### **Application Security**
- ✅ **OAuth authentication** for sensitive services
- ✅ **Non-root containers** enforced
- ✅ **Read-only root filesystems** where possible
- ✅ **Resource limits** prevent resource exhaustion

### **Data Security**
- ✅ **TLS everywhere** (Let's Encrypt certificates)
- ✅ **Secrets in Pulumi config** (encrypted, not in Git)
- ✅ **Synology snapshots** for backups
- ✅ **Optional encryption at rest** (Synology feature)

### **Operational Security**
- ✅ **Infrastructure as Code** - audit trail via Git
- ✅ **Type safety** - Pulumi prevents misconfigurations
- ✅ **Immutable infrastructure** - destroy and rebuild anytime
- ✅ **Tailscale VPN** for admin access (no public cluster API)

---

## Prerequisites

- **Hardware**: Linux host (bare metal or VM) with:
  - 4GB+ RAM (8GB recommended for k3s + services)
  - 2+ CPU cores
  - 20GB+ disk space
- **Synology NAS** with:
  - NFS server enabled
  - API access (for CSI driver)
  - Firewall rules allowing NFS from k3s node
- **Domain name** (e.g., `example.com`)
- **Cloudflare account** (free tier works)
  - Domain's nameservers pointed to Cloudflare
- **OAuth provider** (optional, for protected services):
  - Google OAuth app, GitHub OAuth app, or OIDC provider

---

## Quick Start

### **1. Install Prerequisites**

```bash
# Install Pulumi CLI
curl -fsSL https://get.pulumi.com | sh

# Install Node.js (for TypeScript)
# (Use your system package manager, or nvm)

# Clone this repository
git clone <your-repo-url>
cd homelab
```

### **2. Configure Pulumi**

```bash
cd infrastructure

# Install dependencies
npm install

# Create new Pulumi stack
pulumi stack init dev

# Configure secrets (encrypted in Pulumi state)
pulumi config set cloudflare:apiToken <your-cloudflare-api-token> --secret
pulumi config set synology:host <synology-ip>
pulumi config set synology:username <username>
pulumi config set synology:password <password> --secret
pulumi config set domain example.com

# Configure OAuth secrets (for protected apps)
pulumi config set googleOAuthClientId <client-id>
pulumi config set googleOAuthSecret <client-secret> --secret
```

### **3. Bootstrap k3s** (one-time)

```bash
# On the k3s host machine
../bootstrap/install-k3s.sh

# Configure kubeconfig for Pulumi
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

### **4. Deploy Infrastructure**

```bash
# Preview changes
pulumi preview

# Deploy everything
pulumi up

# Pulumi will show a preview, confirm to proceed
```

### **5. Access Your Services**

Once deployed, your services are available at configured domains:
- `blog.example.com` - Public blog
- `grafana.example.com` - OAuth-protected dashboard
- `home.example.com` - OAuth-protected home automation

All with:
- ✅ Automatic HTTPS
- ✅ Cloudflare DDoS protection
- ✅ No open ports on your home network

---

## Adding a New Service

### **Simple Public Service**

```typescript
// infrastructure/src/apps/my-new-app.ts
import { ExposedWebApp } from "../components/ExposedWebApp";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export const myApp = new ExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain: "app.example.com",
  port: 80
});
```

### **Protected Service with OAuth + Storage**

```typescript
export const privateApp = new ExposedWebApp("private-app", {
  image: "my-private-app:latest",
  domain: "private.example.com",
  port: 8080,
  oauth: {
    provider: "google",
    clientId: config.require("googleOAuthClientId"),
    clientSecret: config.requireSecret("googleOAuthSecret"),
    allowedEmails: ["me@example.com", "family@example.com"]
  },
  storage: {
    size: "50Gi",
    mountPath: "/data"
  }
});
```

### **Deploy**

```bash
# Import in infrastructure/src/index.ts
import "./apps/my-new-app";

# Deploy
pulumi up
```

---

## Monitoring & Observability

### **Built-in**
- **Pulumi Console** - Deployment history, resource graph
- **Kubernetes Dashboard** - Cluster state (optional)
- **kubectl** / **k9s** - CLI cluster management

### **Optional (via components)**
- **Prometheus** - Metrics collection
- **Grafana** - Dashboards and alerting
- **Loki** - Log aggregation
- **Uptime Kuma** - Service uptime monitoring

---

## Future Enhancements

- [ ] Custom Kubernetes operators (using Pulumi's operator framework)
- [ ] Automated Synology backups (snapshot on deploy)
- [ ] Multi-cluster support (edge + homelab)
- [ ] Service mesh (Linkerd for mutual TLS)
- [ ] GitOps integration (Pulumi operator + Flux)
- [ ] Advanced observability (Tempo for tracing)
- [ ] Cost tracking (Pulumi Cloud insights)

---

## Documentation

- [Initial Setup Guide](docs/SETUP.md) - Detailed setup instructions
- [Component Reference](docs/COMPONENTS.md) - All available components
- [Synology Configuration](docs/SYNOLOGY.md) - NFS and CSI setup
- [OAuth Providers](docs/OAUTH.md) - Configuring OAuth apps
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

---

## Why Pulumi Over Alternatives?

| Feature | Pulumi | Helm + YAML | Terraform | CDK8s |
|---------|--------|-------------|-----------|-------|
| **Type Safety** | ✅ TypeScript | ❌ YAML | ⚠️ HCL | ✅ TypeScript |
| **IDE Support** | ✅ Full autocomplete | ❌ Limited | ⚠️ Basic | ✅ Full autocomplete |
| **Reusability** | ✅ Classes/functions | ⚠️ Helm templates | ⚠️ Modules | ✅ Classes/functions |
| **Testing** | ✅ Unit tests | ❌ None | ⚠️ Terratest | ✅ Unit tests |
| **Multi-cloud** | ✅ 100+ providers | ❌ K8s only | ✅ Yes | ❌ K8s only |
| **State Management** | ✅ Built-in | ❌ Helm secrets | ✅ Built-in | ❌ Manual |
| **Loops/Conditionals** | ✅ Native TS | ⚠️ Go templates | ⚠️ HCL | ✅ Native TS |
| **Learning Curve** | ⚠️ Moderate | ✅ Easy (if know K8s) | ⚠️ Moderate | ⚠️ Moderate |

**Bottom line**: Pulumi combines the power of real programming languages with infrastructure management, making complex homelab setups maintainable and type-safe.

---

## License

MIT - Feel free to fork and adapt for your own homelab!

---

## Contributing

This is a personal homelab project, but contributions, suggestions, and forks are welcome! Open an issue or PR if you have ideas for improvements.
