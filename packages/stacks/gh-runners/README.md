# GitHub Actions Runners Stack (Firecracker)

Self-hosted GitHub Actions runners with **VM-level isolation** via Firecracker microVMs.

## Features

- 🔒 **VM Isolation**: Firecracker microVMs with KVM hypervisor
- 🚀 **Fast Boot**: ~125ms startup time per runner
- 🔄 **Auto-Scaling**: Scales 0-N based on GitHub workflow queue
- 🌐 **Network Isolation**: NetworkPolicies prevent lateral movement
- ⚡ **Ephemeral**: Fresh VM per workflow job
- 📦 **Pulumi-Managed**: Fully declarative infrastructure

## Security Model

**Designed for UNTRUSTED workloads** (supply chain attacks, malicious PRs)

### Threat Mitigation

| Threat | Mitigation |
|--------|------------|
| **Malicious workflow code** | KVM-based VM isolation |
| **Lateral movement** | NetworkPolicies + namespace isolation |
| **Cluster access** | Deny k8s API + metadata services |
| **Persistence** | Ephemeral microVMs destroyed after job |

### Defense Layers

1. **VM Isolation** - Kata Containers + Firecracker (KVM hypervisor)
2. **Network Isolation** - NetworkPolicies (deny-all ingress, restricted egress)
3. **Ephemeral Execution** - Fresh microVM per workflow job
4. **Pod Security** - Baseline PSS, non-root, dropped capabilities

## Installation

See [docs/howto/setup-firecracker-runners.md](../../../docs/howto/setup-firecracker-runners.md)

**Quick Start:**

```bash
# 1. Bootstrap k3s nodes (one-time)
npm run bootstrap:firecracker-nodes

# 2. Configure credentials
pulumi config set --secret github:token <your-token>

# 3. Deploy stack
npm run up
```

## Usage

```typescript
import { createGitHubRunners } from "@mrsimpson/homelab-stack-gh-runners";

const runners = createGitHubRunners(homelab, {
  githubScope: "mrsimpson/homelab",
  githubToken: config.requireSecret("github:token"),
  minRunners: 0,
  maxRunners: 5,
  useFirecracker: true,
  runnerLabels: ["self-hosted", "firecracker"],
});
```

**In workflows:**

```yaml
jobs:
  build:
    runs-on: [self-hosted, firecracker]
    steps:
      - run: echo "Running in Firecracker microVM!"
```

## Architecture

```
GitHub Workflow
     ↓
Actions Runner Controller (ARC)
     ↓
Runner Pod (RuntimeClass: kata-fc)
     ↓
Kata Containers
     ↓
Firecracker microVM (KVM)
     ↓
Your workflow code (isolated)
```

## Components

| Component | Purpose |
|-----------|---------|
| **kata-deploy** | DaemonSet that installs Kata Containers on all nodes |
| **RuntimeClass (kata-fc)** | Configures Firecracker as VMM |
| **NetworkPolicies** | Isolate runners from cluster network |
| **ARC Controller** | Manages runner lifecycle and auto-scaling |
| **RunnerScaleSet** | Defines runner pods with Firecracker isolation |

## Configuration

```typescript
export interface GitHubRunnersConfig {
  githubScope: string;        // "org" or "org/repo"
  githubToken: string;         // GitHub App or PAT
  minRunners?: number;         // Default: 0
  maxRunners?: number;         // Default: 5
  useFirecracker?: boolean;    // Default: true
  runnerLabels?: string[];     // Default: ["self-hosted", "linux", "x64", "firecracker"]
}
```

## Performance

| Metric | Value |
|--------|-------|
| Boot time | ~125ms |
| Memory overhead | ~150MB per runner |
| CPU overhead | ~100m per runner |
| Queue latency | <5s (trigger → running) |

## Security Checklist

- ✅ VM-level isolation (Firecracker)
- ✅ Network policies (deny-all + allowlist)
- ✅ Ephemeral execution (no persistence)
- ✅ Pod Security Standards (baseline enforced)
- ✅ No cluster access (k8s API blocked)
- ✅ Metadata services blocked (169.254.x.x)
- ⚠️ Consider: FQDN-based egress filtering (Cilium/Calico)
- ⚠️ Consider: Dedicated runner nodes (node affinity)
- ⚠️ Consider: Workflow approval for external PRs

## Troubleshooting

**Pods stuck in pending:**
```bash
kubectl get nodes -o json | jq '.items[].metadata.labels' | grep kata
kubectl logs -n kube-system -l name=kata-deploy
```

**Devmapper issues:**
```bash
sudo dmsetup status containerd-pool
sudo k3s crictl info | grep snapshotter
```

**Network isolation:**
```bash
kubectl get networkpolicy -n github-runners
kubectl describe netpol -n github-runners restrict-egress
```

## References

- [Setup Guide](../../../docs/howto/setup-firecracker-runners.md)
- [Kata Containers](https://katacontainers.io/)
- [Firecracker](https://firecracker-microvm.github.io/)
- [Actions Runner Controller](https://github.com/actions/actions-runner-controller)
