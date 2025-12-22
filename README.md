# Personal Infrastructure as Code

> Own your software. Control your data. Learn real infrastructure.

## The Age of Personal Software

We're entering an era where running your own software is not just possible—it's practical. Cloud providers have made infrastructure accessible, containers have made deployment consistent, and modern tools have made complexity manageable.

This project is about taking control:
- **Privacy**: Your data stays on your hardware
- **Learning**: Real-world DevOps skills with production-grade tools
- **Ownership**: No vendor lock-in, no surprise bills, no terms of service changes
- **Flexibility**: Run exactly what you want, how you want it

## What This Is

A type-safe, secure homelab infrastructure running Kubernetes (k3s) with Pulumi, exposing services to the internet without opening firewall ports.

**Key Features:**
- 🔒 **Secure by default** - No inbound ports, outbound-only tunnel
- 🛠️ **Type-safe infrastructure** - TypeScript, not YAML
- 🚀 **Production patterns** - Components, OAuth, persistent storage
- 📦 **Everything as code** - Reproducible, version-controlled
- 🌐 **Internet-accessible** - Via Cloudflare Tunnel (or keep private via VPN)

## High-Level Architecture

```
┌──────────────────────────────────────────────┐
│  Internet                                     │
└──────────────────────────────────────────────┘
                  ↓ HTTPS
┌──────────────────────────────────────────────┐
│  Cloudflare Edge                              │
│  • TLS termination                            │
│  • DDoS protection                            │
│  • Optional: OAuth/SSO                        │
└──────────────────────────────────────────────┘
                  ↓ Encrypted Tunnel
          (outbound-only, no ports open)
┌──────────────────────────────────────────────┐
│  Your Home Network                            │
│  ┌────────────────────────────────────────┐  │
│  │  k3s Cluster (Lightweight Kubernetes)  │  │
│  │                                        │  │
│  │  ┌──────────┐  ┌──────────┐          │  │
│  │  │   App    │  │   App    │   ...    │  │
│  │  │ + OAuth  │  │ + Storage│          │  │
│  │  └──────────┘  └──────────┘          │  │
│  │         ↓                             │  │
│  │  ┌──────────────────────────────┐    │  │
│  │  │  Persistent Storage (NFS)    │    │  │
│  │  └──────────────────────────────┘    │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

**Key Principle:** Your home network has **zero inbound ports open**. All traffic flows through an encrypted, outbound-only tunnel to Cloudflare.

## Core Technologies

- **[k3s](https://k3s.io/)** - Lightweight Kubernetes for homelab scale
- **[Pulumi](https://www.pulumi.com/)** - Infrastructure as Code in TypeScript
- **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)** - Secure exposure without port forwarding
- **[OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)** - Authentication layer for services
- **[cert-manager](https://cert-manager.io/)** - Automatic TLS certificates
- **[democratic-csi](https://github.com/democratic-csi/democratic-csi)** - NFS storage integration

## Quick Start

```bash
# Clone repository
git clone https://github.com/yourusername/homelab.git
cd homelab

# Set up cluster and deploy infrastructure
# See docs/howto/setup-cluster.md for details
```

## Project Structure

```
homelab/
├── README.md                    # This file
├── infrastructure/              # Pulumi TypeScript project
│   ├── src/
│   │   ├── components/          # Reusable components (ExposedWebApp, etc.)
│   │   ├── core/                # Core infrastructure (tunnel, certs, ingress)
│   │   ├── apps/                # Your applications
│   │   └── index.ts             # Main entry point
│   ├── package.json
│   └── Pulumi.yaml
├── docs/
│   ├── adr/                     # Architecture Decision Records
│   ├── howto/                   # Task-oriented guides
│   └── examples/                # Complete working examples
└── scripts/                     # Helper utilities
```

## Design Principles

1. **Type-Safe Infrastructure** - Catch errors at compile time, not deploy time
2. **Component-Based** - Reusable patterns, no copy-paste
3. **Security First** - Defense in depth, least privilege, zero trust
4. **Declarative** - Define desired state, Pulumi handles the rest
5. **Reproducible** - Destroy and rebuild entire stack from code

## What You Can Build

- **Personal blog** - Ghost, WordPress, Hugo static site
- **Photo gallery** - Immich, PhotoPrism
- **Dashboard** - Grafana, Homer, Heimdall
- **Home automation** - Home Assistant
- **File sync** - Nextcloud, Seafile
- **Media server** - Jellyfin, Plex
- **Password manager** - Vaultwarden
- **Monitoring** - Prometheus, Grafana, Uptime Kuma
- **Development tools** - GitLab, Gitea, code-server

All with:
- ✅ Automatic HTTPS
- ✅ Optional OAuth protection
- ✅ Persistent storage
- ✅ No open ports on your router

## Documentation

### Getting Started
- [How to Set Up the Cluster](docs/howto/setup-cluster.md) - Bootstrap k3s and Pulumi
- [How to Expose a Web App](docs/howto/expose-web-app.md) - Make an app internet-accessible
- [How to Add OAuth Protection](docs/howto/add-oauth-protection.md) - Secure with Google/GitHub login

### Architecture
- [ADR 001: Pulumi over YAML](docs/adr/001-pulumi-over-yaml.md) - Why TypeScript IaC
- [ADR 002: Cloudflare Tunnel](docs/adr/002-cloudflare-tunnel-exposure.md) - Why tunnel vs port forwarding
- [ADR 003: k3s Runtime](docs/adr/003-k3s-runtime.md) - Why Kubernetes for homelab
- [ADR 004: Component Pattern](docs/adr/004-component-pattern.md) - Reusable infrastructure
- [ADR 005: Development Tooling](docs/adr/005-development-tooling.md) - Biome, Husky, lint-staged
- [ADR 006: Testing Strategy](docs/adr/006-testing-strategy.md) - Layered testing approach
- [ADR 007: Separate App Repositories](docs/adr/007-separate-app-repositories.md) - Published components
- [ADR 008: Secrets Management](docs/adr/008-secrets-management.md) - External Secrets Operator
- [ADR 009: Pulumi Cloud State Backend](docs/adr/009-pulumi-cloud-state-backend.md) - State management

### How-To Guides
- [Set Up Persistent Storage](docs/howto/setup-persistent-storage.md) - NFS integration
- [Deploy a Database](docs/howto/deploy-database.md) - Stateful workloads
- [Add Custom Component](docs/howto/add-custom-component.md) - Extend the system
- [Manage Secrets](docs/howto/manage-secrets.md) - Pulumi config encryption

## Why This Approach?

Traditional homelab setups involve port forwarding, dynamic DNS, manual SSL certificates, and YAML configuration. This project takes a different approach:

- **No port forwarding** → Secure tunnel instead
- **No YAML hell** → TypeScript with type safety
- **No manual certificates** → Automated via cert-manager
- **No imperative scripts** → Declarative Pulumi code

The result: infrastructure that's secure, maintainable, and actually enjoyable to work with.

## Security Model

**Defense in Depth:**
1. **Network Layer** - No inbound ports, outbound-only tunnel
2. **Application Layer** - OAuth2 authentication for sensitive services
3. **Data Layer** - Encrypted secrets, isolated storage
4. **Operational Layer** - Infrastructure as code, audit trail in Git

See [Security Architecture](docs/adr/002-cloudflare-tunnel-exposure.md) for details.

## Contributing

This is a personal homelab project, but contributions are welcome!

- Found a bug? Open an issue
- Have an improvement? Submit a PR
- Want to share your setup? Fork and adapt!

## License

MIT - Use this however you want

## Acknowledgments

Built on the shoulders of giants:
- The k3s team for making Kubernetes accessible
- Pulumi for bringing real programming to IaC
- Cloudflare for secure tunnel technology
- The homelab community for inspiration

---

**Ready to own your infrastructure?** Start with [Setting Up the Cluster](docs/howto/setup-cluster.md).
