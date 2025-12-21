# Secure Homelab Infrastructure

A fully declarative, GitOps-based homelab running on k3s with security-first principles.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Exposure Layer (Internet → Homelab)            │
├─────────────────────────────────────────────────┤
│  Cloudflare Tunnel (cloudflared)                │
│  ├─ Auto-configured from Ingress resources      │
│  ├─ TLS termination at edge                     │
│  └─ Optional: Cloudflare Access (SSO/2FA)       │
│                                                  │
│  Tailscale (VPN for admin access)               │
│  └─ Subnet router mode for full cluster access  │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  k3s Cluster (Lightweight Kubernetes)           │
├─────────────────────────────────────────────────┤
│  GitOps Engine: ArgoCD                          │
│  ├─ Watches this Git repo                       │
│  ├─ Auto-applies changes                        │
│  └─ Self-healing & drift detection              │
│                                                  │
│  Core Infrastructure:                           │
│  ├─ cert-manager      (TLS certificates)        │
│  ├─ external-dns      (DNS automation)          │
│  ├─ ingress-nginx     (Internal routing)        │
│  ├─ democratic-csi    (Synology integration)    │
│  ├─ sealed-secrets    (Encrypted secrets)       │
│  └─ cloudflared       (Tunnel controller)       │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  Storage Layer                                  │
├─────────────────────────────────────────────────┤
│  Synology NAS                                   │
│  ├─ NFS server enabled                          │
│  ├─ CSI driver for dynamic provisioning         │
│  └─ Isolated network access                     │
└─────────────────────────────────────────────────┘
```

## Design Principles

1. **Everything as Code**: All configuration in Git, no manual `kubectl apply`
2. **Declarative by Default**: Desired state defined, GitOps ensures reality matches
3. **Security First**: Defense in depth, least privilege, network segmentation
4. **Isolation**: Services isolated from Synology, strict network policies
5. **Reproducible**: Destroy and rebuild entire stack from this repo

## Directory Structure

```
.
├── bootstrap/              # One-time cluster setup
│   ├── k3s/               # k3s installation scripts
│   └── argocd/            # ArgoCD bootstrap manifests
│
├── infrastructure/         # Core cluster components (managed by ArgoCD)
│   ├── argocd/            # ArgoCD applications (App of Apps pattern)
│   ├── cert-manager/      # Certificate management
│   ├── external-dns/      # DNS automation
│   ├── ingress-nginx/     # Ingress controller
│   ├── sealed-secrets/    # Secrets encryption
│   ├── democratic-csi/    # Synology CSI driver
│   ├── cloudflared/       # Cloudflare Tunnel
│   └── tailscale/         # Tailscale subnet router (optional)
│
├── platform/              # Shared platform services
│   ├── monitoring/        # Prometheus, Grafana
│   └── auth/              # SSO (future: Authelia/Authentik)
│
├── apps/                  # Your applications
│   └── example-app/       # Example with declarative exposure
│
├── operators/             # Custom operators (future)
│   └── README.md
│
├── scripts/               # Helper utilities
│   ├── install.sh         # Complete installation script
│   └── seal-secret.sh     # Create sealed secrets
│
└── docs/                  # Documentation
    ├── SETUP.md           # Initial setup guide
    ├── DEPLOYMENT.md      # How to deploy apps
    └── SYNOLOGY.md        # Synology configuration
```

## Quick Start

### Prerequisites

- Linux host with SSH access (or bare metal)
- Synology NAS with NFS enabled
- Domain name (for Cloudflare Tunnel)
- Cloudflare account (free tier works)

### Installation

1. **Clone this repository**
   ```bash
   git clone <your-repo>
   cd homelab
   ```

2. **Configure your environment**
   ```bash
   cp bootstrap/k3s/config.env.example bootstrap/k3s/config.env
   # Edit config.env with your settings
   ```

3. **Run the installation**
   ```bash
   ./scripts/install.sh
   ```

4. **Access ArgoCD UI**
   ```bash
   kubectl -n argocd get secret argocd-initial-admin-secret \
     -o jsonpath="{.data.password}" | base64 -d
   ```

5. **Deploy an application**
   - Add Helm chart to `apps/your-app/`
   - Commit and push
   - ArgoCD automatically deploys it

## Declarative Service Exposure

Services are exposed via Ingress annotations:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    # Automatic TLS via cert-manager
    cert-manager.io/cluster-issuer: letsencrypt-prod

    # Expose via Cloudflare Tunnel
    external-dns.alpha.kubernetes.io/target: tunnel.example.com

    # Optional: Require authentication
    # cloudflare-access.io/enabled: "true"
spec:
  ingressClassName: nginx
  rules:
  - host: my-app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80
  tls:
  - hosts:
    - my-app.example.com
    secretName: my-app-tls
```

**That's it!** The system automatically:
- ✅ Provisions TLS certificate from Let's Encrypt
- ✅ Configures Cloudflare Tunnel route
- ✅ Updates DNS records
- ✅ Routes traffic to your service

## Storage Usage

Request Synology storage declaratively:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: synology-nfs
  resources:
    requests:
      storage: 10Gi
```

The CSI driver automatically creates the directory on Synology and mounts it.

## Security Features

- ✅ No ports open on home router (outbound tunnel only)
- ✅ Network policies between namespaces
- ✅ Secrets encrypted in Git (sealed-secrets)
- ✅ TLS everywhere (cert-manager)
- ✅ Optional SSO/2FA (Cloudflare Access)
- ✅ Synology isolated from internet
- ✅ Non-root containers enforced
- ✅ Resource limits on all pods

## Monitoring

- **ArgoCD UI**: Cluster state visualization
- **Prometheus/Grafana**: Metrics and dashboards (optional)
- **k9s**: Terminal UI for cluster management

## Future Enhancements

- [ ] Custom operators for homelab-specific resources
- [ ] Automated backups to Synology
- [ ] Multi-cluster federation
- [ ] Service mesh (Linkerd/Istio)
- [ ] Advanced observability (Loki, Tempo)

## Documentation

- [Initial Setup Guide](docs/SETUP.md)
- [Deploying Applications](docs/DEPLOYMENT.md)
- [Synology Configuration](docs/SYNOLOGY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Contributing

This is a personal homelab, but feel free to fork and adapt!

## License

MIT
