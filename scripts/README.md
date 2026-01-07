# Homelab Scripts

Operational scripts for managing the K3s cluster and Pulumi infrastructure.

## Available Scripts

### `install-k3s.sh`
Installs K3s on the system with proper configuration.

```bash
./scripts/install-k3s.sh
```

### `clean-cluster.sh`
Safely destroys all Pulumi-managed Kubernetes resources and cleans up the cluster.

**Features:**
- Destroys Pulumi stack resources
- Handles stuck Longhorn namespaces with finalizers
- Removes CRD finalizers blocking deletion
- Verifies complete cleanup
- Safe with confirmation prompts

**Usage:**
```bash
./scripts/clean-cluster.sh
```

**What it does:**
1. Destroys Pulumi stack (dev)
2. Cleans up terminating namespaces
3. Deletes custom namespaces
4. Verifies cluster is clean

**Example Output:**
```
ℹ Homelab Cluster Cleanup Script
ℹ Project Root: /Users/user/homelab
⚠ This will destroy all Pulumi-managed resources in the cluster
Continue? (yes/no): yes

ℹ Step 1/4: Destroying Pulumi stack...
✓ Pulumi stack destroyed

ℹ Step 2/4: Cleaning up stuck namespaces...
✓ No terminating namespaces found

ℹ Step 3/4: Deleting custom namespaces...
✓ Custom namespaces deleted

ℹ Step 4/4: Verifying cluster cleanup...
✓ All custom namespaces cleaned

✓ Cluster cleanup complete!
```

### `uninstall-k3s.sh`
Completely uninstalls K3s from the system while preserving all certificates and credentials.

**Features:**
- Backs up all K3s certificates and keys
- Preserves kubeconfig and token files
- Creates restore instructions
- Gracefully stops K3s services
- Runs official K3s uninstall script
- Can restore later with same credentials

**Usage:**
```bash
./scripts/uninstall-k3s.sh
```

**What it does:**
1. Backs up all certificates and credentials to `.k3s-backup/`
2. Backs up kubeconfig files
3. Backs up kubelet certificates
4. Creates restoration instructions
5. Stops K3s services
6. Runs K3s uninstall script
7. Verifies complete uninstall

**Backup Location:**
```
.k3s-backup/
├── config/
│   ├── server/
│   │   ├── tls.crt
│   │   └── tls.key
│   ├── server-ca.crt
│   ├── server-ca.key
│   ├── client-ca.crt
│   ├── client-ca.key
│   └── token
├── data/
│   └── agent/
│       └── kubelet/
├── kubeconfigs/
│   └── k3s.yaml
└── RESTORE_INSTRUCTIONS.md
```

**Restoring After Uninstall:**
```bash
# 1. Reinstall K3s
curl -sfL https://get.k3s.io | sh -

# 2. Follow restoration instructions
cat .k3s-backup/RESTORE_INSTRUCTIONS.md
```

## Typical Workflow

### Clean and Redeploy Cluster

```bash
# 1. Clean up Pulumi resources
./scripts/clean-cluster.sh

# 2. Verify cluster is clean
kubectl get namespaces

# 3. Create fresh Pulumi stack
pulumi stack init dev

# 4. Redeploy infrastructure
pulumi up --stack dev --yes
```

### Complete System Reset

```bash
# 1. Clean cluster resources
./scripts/clean-cluster.sh

# 2. Remove Pulumi stack
pulumi stack rm dev --yes

# 3. Uninstall K3s (preserves credentials)
./scripts/uninstall-k3s.sh

# 4. Reinstall K3s
curl -sfL https://get.k3s.io | sh -

# 5. Restore credentials (optional)
# Follow .k3s-backup/RESTORE_INSTRUCTIONS.md

# 6. Create fresh Pulumi stack
pulumi stack init dev

# 7. Redeploy infrastructure
pulumi up --stack dev --yes
```

## Error Handling

All scripts include robust error handling:
- Confirmation prompts before destructive operations
- Color-coded logging for clarity
- Meaningful error messages
- Graceful failure handling

### Common Issues

**"kubectl not found"**
- Install kubectl: https://kubernetes.io/docs/tasks/tools/

**"Not connected to Kubernetes cluster"**
- Verify K3s is running: `systemctl status k3s`
- Check kubeconfig: `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml`

**Namespaces stuck in Terminating**
- The scripts handle this automatically by removing finalizers
- If still stuck, check the troubleshooting guide in `docs/howto/CLUSTER_TEARDOWN.md`

## Reference

For detailed information about cluster teardown and troubleshooting, see:
- `docs/howto/CLUSTER_TEARDOWN.md` - Detailed teardown procedures
- `CLUSTER_TEARDOWN.md` (root) - Quick reference guide

