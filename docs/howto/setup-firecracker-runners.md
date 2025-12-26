# How to: Setup Firecracker-Based GitHub Actions Runners

This guide shows you how to deploy self-hosted GitHub Actions runners with **VM-level isolation** using Firecracker microVMs.

## Why Firecracker?

**Threat Model**: GitHub Actions supply chain attacks and compromised workflows

If you run **untrusted workflows** (public PRs, marketplace actions, external contributors), container isolation is insufficient. Firecracker provides:

- ✅ **KVM-based hypervisor isolation** (stronger than namespaces/cgroups)
- ✅ **Fast boot times** (~125ms per microVM)
- ✅ **Ephemeral execution** (fresh VM per workflow job)
- ✅ **Minimal attack surface** (purpose-built for serverless workloads)

## Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Defense Layer 1: VM Isolation                          │
│ - Each runner in separate Firecracker microVM          │
│ - KVM hypervisor enforced memory/CPU isolation         │
│ - Separate kernel per microVM                          │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Defense Layer 2: Network Isolation                     │
│ - NetworkPolicies deny all pod-to-pod traffic          │
│ - Only allow outbound HTTPS to GitHub API              │
│ - Block access to k8s API server                       │
│ - Block metadata services (169.254.169.254)            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Defense Layer 3: Ephemeral Execution                   │
│ - MicroVM destroyed after each workflow job            │
│ - No persistence between jobs                          │
│ - Fresh root filesystem every time                     │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Defense Layer 4: Pod Security Standards                │
│ - Baseline PSS enforced on runner namespace            │
│ - Non-root containers                                   │
│ - Drop all capabilities                                 │
│ - Seccomp enabled                                       │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- k3s cluster (installed via `bootstrap/install-k3s.sh`)
- Linux kernel with KVM support (check: `ls /dev/kvm`)
- At least 10GB free disk space (for devmapper pool)
- GitHub repository or organization (for runner registration)
- GitHub App or Personal Access Token

## Installation

### Step 1: Bootstrap k3s Nodes

Configure containerd for device mapper snapshotter (required by Firecracker):

```bash
# Run on each k3s node
npm run bootstrap:firecracker-nodes

# This script:
# 1. Verifies /dev/kvm is accessible
# 2. Configures containerd with device mapper
# 3. Creates devmapper thin pool
# 4. Restarts k3s with new configuration
```

**Verification:**

```bash
# Check containerd is using devmapper
sudo k3s crictl info | grep snapshotter
# Should show: "snapshotter": "devmapper"

# Check devmapper pool exists
sudo dmsetup ls
# Should show: containerd-pool
```

### Step 2: Create GitHub App or PAT

You need credentials for runners to register with GitHub.

**Option A: GitHub App (Recommended)**

1. Go to your GitHub org/repo → Settings → GitHub Apps → New GitHub App
2. Name: `homelab-actions-runners`
3. Permissions:
   - Repository → Actions: **Read & Write**
   - Repository → Metadata: **Read-only**
4. Install app to your repositories
5. Copy:
   - App ID
   - Installation ID (from install URL)
   - Generate private key

**Option B: Personal Access Token**

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Repository access: Select repositories
3. Permissions:
   - Actions: **Read & Write**
4. Generate token and copy

### Step 3: Store Credentials in Pulumi ESC

Store GitHub credentials securely:

```bash
# Create environment in Pulumi ESC
pulumi config set --secret github:token <your-token-or-app-credentials>

# Or store in existing ESC environment
# See docs/howto/manage-secrets.md
```

### Step 4: Configure Runner Stack

Add runner configuration to your Pulumi stack:

```typescript
// In your src/index.ts or separate runner file
import { createGitHubRunners } from "@mrsimpson/homelab-stack-gh-runners";

const config = new pulumi.Config();
const githubToken = config.requireSecret("github:token");

const runners = createGitHubRunners(homelab, {
  githubScope: "mrsimpson/homelab", // or "mrsimpson" for org-level
  githubToken: githubToken,
  minRunners: 0, // Scale to zero when idle
  maxRunners: 5, // Max concurrent runners
  useFirecracker: true, // Enable Firecracker isolation
  runnerLabels: ["self-hosted", "linux", "x64", "firecracker"],
});

export const runnersStatus = runners;
```

### Step 5: Deploy Stack

```bash
# Preview changes
npm run preview

# Deploy
npm run up

# Check deployment
kubectl get pods -n github-runners
kubectl get ds -n kube-system kata-deploy
```

**Expected output:**

```
NAME                                  READY   STATUS    RESTARTS   AGE
kata-deploy-xxxxx                     2/2     Running   0          2m
actions-runner-controller-xxxxx       1/1     Running   0          1m
github-runner-scale-set-listener-xxx  1/1     Running   0          1m
```

## Usage in Workflows

Target your self-hosted runners:

```yaml
name: CI Pipeline
on: [push]

jobs:
  build:
    # Use your runner labels
    runs-on: [self-hosted, firecracker]

    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build
```

## Verification

### Check Kata Installation

```bash
# Verify kata-deploy is running
kubectl get ds -n kube-system kata-deploy

# Check nodes are labeled
kubectl get nodes -o custom-columns=NAME:.metadata.name,KATA:.metadata.labels.katacontainers\\.io/kata-runtime
```

### Check RuntimeClass

```bash
# Verify RuntimeClass exists
kubectl get runtimeclass kata-fc -o yaml

# Should show handler: kata-fc
```

### Check Network Policies

```bash
# List network policies
kubectl get networkpolicy -n github-runners

# Should show:
# - deny-all-ingress
# - restrict-egress
# - deny-k8s-api
# - deny-metadata
```

### Test Runner Isolation

Create a test workflow to verify isolation:

```yaml
name: Test Runner Isolation
on: workflow_dispatch

jobs:
  test-isolation:
    runs-on: [self-hosted, firecracker]
    steps:
      - name: Check if running in VM
        run: |
          # Check for KVM virtualization
          if grep -q "QEMU\|KVM" /proc/cpuinfo; then
            echo "✓ Running in microVM"
          else
            echo "✗ Not running in microVM"
            exit 1
          fi

      - name: Test network isolation
        run: |
          # Should succeed (GitHub API)
          curl -I https://api.github.com

          # Should fail (k8s API)
          ! curl -k https://kubernetes.default.svc || exit 1

          echo "✓ Network isolation working"
```

## Troubleshooting

### Kata Pods Stuck in Pending

**Symptoms:** Runner pods show `0/1 nodes are available: insufficient resources`

**Solution:**
```bash
# Check node labels
kubectl get nodes -o json | jq '.items[].metadata.labels'

# Verify kata-deploy completed successfully
kubectl logs -n kube-system -l name=kata-deploy --tail=50

# Check containerd config
sudo cat /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl
```

### Devmapper Pool Full

**Symptoms:** `failed to create thin device: No space left on device`

**Solution:**
```bash
# Check pool usage
sudo dmsetup status containerd-pool

# Expand pool (increase size in bootstrap script)
# Then re-run: npm run bootstrap:firecracker-nodes
```

### Runners Not Registering

**Symptoms:** No runners appear in GitHub Settings → Actions → Runners

**Solution:**
```bash
# Check runner controller logs
kubectl logs -n github-runners -l app.kubernetes.io/name=actions-runner-controller

# Verify GitHub token
kubectl get secret -n github-runners github-runner-secret -o yaml

# Check network policies aren't blocking GitHub API
kubectl logs -n github-runners <runner-pod>
```

### KVM Not Available

**Symptoms:** `/dev/kvm: No such file or directory`

**Solution:**
```bash
# Check if CPU supports virtualization
egrep -o '(vmx|svm)' /proc/cpuinfo

# Load KVM modules
sudo modprobe kvm kvm_intel  # or kvm_amd for AMD

# Make persistent
echo "kvm" | sudo tee -a /etc/modules
echo "kvm_intel" | sudo tee -a /etc/modules  # or kvm_amd
```

## Security Considerations

### What This Protects Against

✅ **Malicious workflow code** - VM isolation prevents breakout
✅ **Supply chain attacks** - Actions run in isolated VMs
✅ **Lateral movement** - NetworkPolicies block cluster access
✅ **Persistence** - Ephemeral VMs destroyed after each job

### What This Does NOT Protect Against

❌ **Secrets in workflow files** - Don't commit secrets to Git
❌ **GitHub account compromise** - Use 2FA, review access
❌ **DDoS via workflows** - Rate limit workflows, monitor costs
❌ **Social engineering** - Review PRs before running workflows

### Additional Hardening

For production deployments, consider:

1. **Dedicated runner nodes** - Isolate runner nodes from app nodes
2. **FQDN-based egress filtering** - Use Cilium/Calico for domain filtering
3. **Audit logging** - Enable k3s audit logs for runner namespace
4. **Workflow approval** - Require approval for first-time contributors
5. **Secrets rotation** - Rotate GitHub tokens regularly

## Performance

Typical metrics for Firecracker runners:

| Metric | Value | Notes |
|--------|-------|-------|
| **Boot time** | ~125ms | microVM startup |
| **Memory overhead** | ~150MB | Per runner pod |
| **CPU overhead** | ~100m | VM management |
| **Concurrent runners** | 5-10 | Per node (depends on resources) |
| **Job queue latency** | <5s | Time from job trigger to runner start |

## Cost Comparison

| Scenario | GitHub-Hosted | Self-Hosted (Firecracker) |
|----------|---------------|---------------------------|
| **Small repo** (1000 min/month) | $8/month | $0 (homelab) |
| **Medium repo** (5000 min/month) | $40/month | $0 (homelab) |
| **Large repo** (20000 min/month) | $160/month | $0 (homelab) |

**Trade-off**: Self-hosted requires operational overhead (maintenance, updates, monitoring).

## Cleanup

To remove runners:

```bash
# Delete runner stack
pulumi destroy --target urn:pulumi:dev::homelab::pkg:index:GitHubRunners::github-runners

# Uninstall Kata
kubectl delete ds -n kube-system kata-deploy

# Remove devmapper pool (if desired)
sudo dmsetup remove containerd-pool
sudo rm -rf /var/lib/containerd/devmapper
```

## References

- [Kata Containers Documentation](https://katacontainers.io/)
- [Firecracker microVM](https://firecracker-microvm.github.io/)
- [Actions Runner Controller](https://github.com/actions/actions-runner-controller)
- [Kubernetes NetworkPolicies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [k3s containerd configuration](https://docs.k3s.io/advanced#configuring-containerd)

## Next Steps

- [Manage Secrets](./manage-secrets.md) - Secure GitHub token storage
- [Monitor Infrastructure](./setup-observability.md) - Add metrics for runners
- [Network Policies](./configure-network-policies.md) - Advanced egress filtering
