#!/bin/bash

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
    echo -e "${GREEN}✓${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*"
}

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info "K3s Uninstall Script (Preserves Certificates & Credentials)"
echo

# Important paths
K3S_DATA_DIR="${K3S_DATA_DIR:=/var/lib/rancher/k3s}"
K3S_CONFIG_DIR="${K3S_CONFIG_DIR:=/etc/rancher/k3s}"
BACKUP_DIR="${PROJECT_ROOT}/.k3s-backup"

log_info "K3s Data Directory: $K3S_DATA_DIR"
log_info "K3s Config Directory: $K3S_CONFIG_DIR"
log_info "Backup Directory: $BACKUP_DIR"
echo

# Confirm before proceeding
log_warn "This will UNINSTALL K3s completely from the system"
log_warn "Certificates and credentials will be preserved in: $BACKUP_DIR"
read -p "Continue? (yes/no): " -r CONFIRM
if [[ ! $CONFIRM =~ ^[Yy][Ee][Ss]$ ]]; then
    log_info "Cancelled"
    exit 0
fi
echo

# Create backup directory
log_info "Creating backup directory..."
mkdir -p "$BACKUP_DIR"
log_success "Backup directory created"
echo

# Step 1: Backup certificates and credentials
log_info "Step 1/5: Backing up certificates and credentials..."

CERT_FILES=(
    "server/tls.crt"
    "server/tls.key"
    "server-ca.crt"
    "server-ca.key"
    "client-ca.crt"
    "client-ca.key"
    "token"
    "kubeconfig.yaml"
)

for file in "${CERT_FILES[@]}"; do
    SOURCE_PATH="$K3S_CONFIG_DIR/$file"
    BACKUP_PATH="$BACKUP_DIR/config/$(dirname "$file")"
    
    if [ -f "$SOURCE_PATH" ]; then
        mkdir -p "$BACKUP_PATH"
        cp -v "$SOURCE_PATH" "$BACKUP_PATH/$(basename "$file")" 2>/dev/null || true
        log_success "Backed up: $file"
    fi
done

# Backup kubelet certificates
if [ -d "$K3S_DATA_DIR/agent/kubelet" ]; then
    mkdir -p "$BACKUP_DIR/data/agent"
    cp -r "$K3S_DATA_DIR/agent/kubelet" "$BACKUP_DIR/data/agent/" 2>/dev/null || true
    log_success "Backed up kubelet certificates"
fi

# Backup kubeconfig from default locations
for kubeconfig in ~/.kube/config /etc/rancher/k3s/k3s.yaml; do
    if [ -f "$kubeconfig" ]; then
        mkdir -p "$BACKUP_DIR/kubeconfigs"
        cp -v "$kubeconfig" "$BACKUP_DIR/kubeconfigs/$(basename "$kubeconfig")" 2>/dev/null || true
        log_success "Backed up: $kubeconfig"
    fi
done

echo

# Step 2: Create restore instructions
log_info "Step 2/5: Creating restore instructions..."

cat > "$BACKUP_DIR/RESTORE_INSTRUCTIONS.md" << 'RESTORE_EOF'
# K3s Restoration Instructions

This directory contains backed-up K3s certificates, credentials, and kubeconfig.

## Prerequisites

1. K3s is freshly installed on the system
2. K3s is running but has new certificates

## Restoration Steps

### Option 1: Restore with existing K3s node (recommended)

If you're keeping the same K3s node and just reinstalling:

```bash
# Stop K3s
sudo systemctl stop k3s || sudo /usr/local/bin/k3s-uninstall.sh

# Restore files
sudo cp -r config/* /etc/rancher/k3s/
sudo chown -R root:root /etc/rancher/k3s
sudo chmod 600 /etc/rancher/k3s/*.key

# Restore kubelet certificates if needed
if [ -d "data/agent/kubelet" ]; then
    sudo cp -r data/agent/kubelet /var/lib/rancher/k3s/agent/
    sudo chown -R root:root /var/lib/rancher/k3s/agent/kubelet
fi

# Start K3s
sudo systemctl start k3s
sudo systemctl status k3s
```

### Option 2: Manual kubeconfig restoration

To use the backed-up kubeconfig with a fresh K3s installation:

```bash
# Restore kubeconfig to default location
mkdir -p ~/.kube
cp kubeconfigs/k3s.yaml ~/.kube/config
chmod 600 ~/.kube/config

# Verify connection
kubectl cluster-info
```

## Important Notes

- Keep this backup directory safe - it contains sensitive credentials
- The certificates are tied to specific K3s node IPs/hostnames
- If the node IP changes, you'll need to regenerate certificates
- Token expiration: Check if the K3s token has expired

## Verification

After restoration, verify everything is working:

```bash
# Check K3s status
kubectl version
kubectl get nodes
kubectl get ns
kubectl get pods -A
```

If the node IP has changed, you may need to:
1. Update DNS records pointing to the node
2. Update kubeconfig server URL to match new IP
3. Reinstall K3s with updated node IP
RESTORE_EOF

log_success "Restoration instructions created"
echo

# Step 3: Stop K3s
log_info "Step 3/5: Stopping K3s..."

# Check if K3s is running via systemd
if systemctl is-active --quiet k3s 2>/dev/null || systemctl is-active --quiet k3s-server 2>/dev/null; then
    log_info "Stopping K3s service..."
    sudo systemctl stop k3s 2>/dev/null || sudo systemctl stop k3s-server 2>/dev/null || true
    sleep 5
    log_success "K3s service stopped"
else
    log_warn "K3s service not running via systemd"
fi

echo

# Step 4: Run k3s uninstall script
log_info "Step 4/5: Running K3s uninstall script..."

UNINSTALL_SCRIPT="/usr/local/bin/k3s-uninstall.sh"

if [ -f "$UNINSTALL_SCRIPT" ]; then
    log_info "Found uninstall script: $UNINSTALL_SCRIPT"
    log_warn "Running uninstall (this may prompt for sudo password)..."
    
    sudo bash "$UNINSTALL_SCRIPT" 2>&1 | grep -v "^$" || true
    log_success "K3s uninstalled"
else
    log_error "K3s uninstall script not found at: $UNINSTALL_SCRIPT"
    log_warn "Attempting manual cleanup..."
    
    # Manual cleanup
    sudo systemctl disable k3s 2>/dev/null || true
    sudo systemctl disable k3s-server 2>/dev/null || true
    
    # Remove K3s files
    sudo rm -rf /var/lib/rancher/k3s 2>/dev/null || true
    sudo rm -rf /etc/rancher/k3s 2>/dev/null || true
    sudo rm -f /usr/local/bin/k3s* 2>/dev/null || true
    
    log_success "Manual K3s cleanup completed"
fi

echo

# Step 5: Verification
log_info "Step 5/5: Verifying uninstall..."

if command -v k3s &> /dev/null; then
    log_warn "Warning: k3s command still available"
else
    log_success "k3s command removed"
fi

if systemctl is-active --quiet k3s 2>/dev/null; then
    log_error "Error: K3s service is still running"
else
    log_success "K3s service confirmed stopped"
fi

echo

# Summary
log_success "K3s uninstall complete!"
echo
log_info "Backup Summary:"
ls -lh "$BACKUP_DIR"
echo
log_info "Important files backed up:"
find "$BACKUP_DIR" -type f | sed 's|^|  - |'
echo
log_warn "To restore K3s with the same credentials later:"
echo "  1. Reinstall K3s: curl -sfL https://get.k3s.io | sh -"
echo "  2. Follow instructions in: $BACKUP_DIR/RESTORE_INSTRUCTIONS.md"
echo
log_info "To completely remove this backup:"
echo "  rm -rf $BACKUP_DIR"
