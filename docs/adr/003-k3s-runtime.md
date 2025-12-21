# ADR 003: k3s as Container Runtime

**Status:** Accepted
**Date:** 2025-12-21
**Deciders:** Project maintainers

## Context

Need a container orchestration platform for running homelab services with infrastructure-as-code management, service discovery, and persistent storage.

## Decision

Use **k3s** (Lightweight Kubernetes) as the container runtime.

## Rationale

### Why Kubernetes?

**Infrastructure as Code Native:**
- Declarative API (perfect for Pulumi)
- Everything is a resource with clear schema
- Reconciliation loops ensure desired state
- Mature ecosystem of controllers and operators

**Service Abstraction:**
- Clean separation: Deployment, Service, Ingress
- Service discovery built-in
- Load balancing automatic
- Horizontal scaling when needed

**Persistent Storage:**
- PersistentVolumeClaim abstraction
- CSI driver ecosystem (democratic-csi for NFS)
- Dynamic provisioning
- Storage independent of compute

**Extensibility:**
- Custom Resource Definitions (CRDs)
- Can build custom operators in future
- Rich ecosystem of add-ons

### Why k3s Specifically?

**Lightweight:**
- ~100MB binary (vs 1GB+ for full Kubernetes)
- Lower memory footprint (~512MB vs 2GB+)
- Perfect for homelab single-node or small cluster

**Batteries Included:**
- Includes everything needed out of box
- Built-in SQLite storage (no etcd required for single-node)
- Can upgrade to etcd/PostgreSQL if needed

**Production Ready:**
- CNCF certified Kubernetes
- Same API as full Kubernetes
- Used in edge computing and IoT
- Battle-tested in production environments

**Simple Installation:**
- One-line install script
- Easy upgrades
- Minimal dependencies

**ARM Support:**
- Works on Raspberry Pi, ARM servers
- Same binary for x86 and ARM

## How It Fits

```
Pulumi (TypeScript)
  ↓ Provisions
k3s Cluster
  ├─ Core Infrastructure (cert-manager, ingress-nginx, etc.)
  ├─ cloudflared (Cloudflare Tunnel)
  ├─ democratic-csi (NFS storage)
  └─ Application Pods
```

**Key insight:** Kubernetes' declarative API is perfect for Pulumi's component model.

## Trade-offs

### Accepted

**Complexity vs Docker Compose:**
- Kubernetes is more complex than Docker Compose
- **Justification:**
  - Need proper service abstraction for multi-container apps
  - Ingress controller for routing
  - Storage abstraction (CSI drivers)
  - Future extensibility (custom operators)
  - Learning opportunity (real-world Kubernetes skills)

**Resource Overhead:**
- k3s uses more resources than plain Docker
- **Justification:**
  - Still very lightweight (~512MB RAM)
  - Acceptable on modern hardware (4GB+ RAM)
  - Benefits outweigh overhead for homelab

**Learning Curve:**
- Kubernetes concepts (Pods, Services, Deployments, etc.)
- **Justification:**
  - Transferable skills (Kubernetes is industry standard)
  - Pulumi abstracts complexity into components
  - Good learning platform

## Alternatives Considered

### Docker Compose

**Pros:**
- Simpler than Kubernetes
- Less resource overhead
- Easier to understand initially

**Cons:**
- ❌ No declarative infrastructure (YAML, but imperative execution)
- ❌ Poor service discovery (manual linking)
- ❌ No dynamic storage provisioning
- ❌ Labels-based configuration less clean than Ingress
- ❌ Not extensible (no CRDs, no operators)
- ❌ Harder to manage with Pulumi

**Verdict:** Too limited for infrastructure-as-code approach

### Docker Swarm

**Pros:**
- Simpler than Kubernetes
- Built into Docker

**Cons:**
- ❌ Effectively deprecated (low adoption)
- ❌ Limited ecosystem
- ❌ No CSI drivers for storage
- ❌ Poor Pulumi support

**Verdict:** Dead ecosystem

### Nomad

**Pros:**
- Simpler than Kubernetes
- Good for mixed workloads (containers, VMs, binaries)

**Cons:**
- ❌ Smaller ecosystem than Kubernetes
- ❌ No CSI driver ecosystem
- ❌ Less mature Pulumi support
- ❌ No Ingress abstraction

**Verdict:** Interesting but smaller ecosystem

### Full Kubernetes (kubeadm, k0s, etc.)

**Pros:**
- Full Kubernetes feature set
- More configuration options

**Cons:**
- ❌ Higher resource requirements
- ❌ More complex setup and maintenance
- ❌ Overkill for homelab

**Verdict:** k3s provides same API with less overhead

### Kubernetes Distributions (RKE2, MicroK8s, Talos, etc.)

**Pros:**
- Various opinionated setups
- Some optimized for specific use cases

**Cons:**
- ❌ More complex than k3s
- ❌ k3s is proven and well-documented
- ❌ k3s has better community for homelab use

**Verdict:** k3s is the sweet spot

## Implementation Notes

### Single-Node Setup

For most homelabs, single-node k3s is sufficient:
- SQLite for cluster state (no etcd overhead)
- All pods on one node (no networking complexity)
- Can easily expand to multi-node later if needed

### High Availability (Optional)

If needed in future:
- Add 2 more control plane nodes
- Switch to etcd or PostgreSQL for cluster state
- k3s makes this straightforward

### Upgrades

k3s upgrade process:
```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=vX.Y.Z sh -
```

Or use system upgrade controller for automated upgrades.

## Configuration

### k3s Install Options

```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \    # Make kubeconfig readable
  --disable traefik                # We use ingress-nginx instead
```

### Why Disable Traefik?

k3s includes Traefik by default, but we use ingress-nginx:
- More widely used (better documentation)
- Better Pulumi integration
- Consistent with production Kubernetes setups

## Future Possibilities

**Custom Operators:**
- Could build homelab-specific CRDs (ExposedWebApp as CRD)
- Kubernetes Operator SDK in Go
- Or Pulumi's operator framework

**Service Mesh:**
- Could add Linkerd for mutual TLS
- Or Istio for advanced traffic management
- k3s supports this if needed

**Multi-Cluster:**
- Could run k3s at edge + cloud
- Cluster federation
- k3s lightweight enough for Raspberry Pi at edge

## References

- [k3s Documentation](https://docs.k3s.io/)
- [k3s GitHub](https://github.com/k3s-io/k3s)
- [Pulumi Kubernetes Provider](https://www.pulumi.com/registry/packages/kubernetes/)
- [CNCF k3s](https://www.cncf.io/projects/k3s/)
