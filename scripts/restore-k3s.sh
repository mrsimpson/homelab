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

log_info "K3s Restore Script"
echo

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root (sudo ./restore-k3s.sh)"
    exit 1
fi

# Important paths
K3S_DATA_DIR="${K3S_DATA_DIR:=/var/lib/rancher/k3s}"
K3S_CONFIG_DIR="${K3S_CONFIG_DIR:=/etc/rancher/k3s}"
BACKUP_DIR="${PROJECT_ROOT}/.k3s-backup"

log_info "K3s Data Directory: $K3S_DATA_DIR"
log_info "K3s Config Directory: $K3S_CONFIG_DIR"
log_info "Backup Directory: $BACKUP_DIR"
echo

# Verify backup exists
if [ ! -d "$BACKUP_DIR" ]; then
    log_error "Backup directory not found: $BACKUP_DIR"
    log_error "Please run uninstall-k3s.sh first to create a backup"
    exit 1
fi

# Check if K3s is installed
if ! command -v k3s &> /dev/null; then
    log_error "K3s is not installed"
    log_error "Please install K3s first with: sudo ./install-k3s.sh"
    exit 1
fi

# Confirm before proceeding
log_warn "This will RESTORE K3s certificates and credentials from backup"
log_warn "Current K3s certificates will be replaced with backed-up ones"
read -p "Continue? (yes/no): " -r CONFIRM
if [[ ! $CONFIRM =~ ^[Yy][Ee][Ss]$ ]]; then
    log_info "Cancelled"
    exit 0
fi
echo

# Step 1: Stop K3s
log_info "Step 1/5: Stopping K3s..."
systemctl stop k3s 2>/dev/null || true
sleep 3
log_success "K3s stopped"
echo

# Step 2: Clean database
log_info "Step 2/5: Cleaning database (will be recreated with restored credentials)..."
rm -rf "$K3S_DATA_DIR/server/db" 2>/dev/null || true
rm -rf "$K3S_DATA_DIR/server/cred" 2>/dev/null || true
log_success "Database cleaned"
echo

# Step 3: Restore certificates and credentials
log_info "Step 3/5: Restoring certificates and credentials..."

# Restore server TLS certificates
if [ -d "$BACKUP_DIR/server/tls" ]; then
    log_info "Restoring server TLS certificates..."
    mkdir -p "$K3S_DATA_DIR/server/tls"
    cp -v "$BACKUP_DIR/server/tls/"* "$K3S_DATA_DIR/server/tls/" 2>/dev/null || true
    chown root:root "$K3S_DATA_DIR/server/tls/"*
    chmod 600 "$K3S_DATA_DIR/server/tls/"*.key 2>/dev/null || true
    chmod 644 "$K3S_DATA_DIR/server/tls/"*.crt 2>/dev/null || true
    log_success "Server TLS certificates restored"
fi

# Restore etcd certificates
if [ -d "$BACKUP_DIR/server/tls/etcd" ]; then
    log_info "Restoring etcd certificates..."
    mkdir -p "$K3S_DATA_DIR/server/tls/etcd"
    cp -v "$BACKUP_DIR/server/tls/etcd/"* "$K3S_DATA_DIR/server/tls/etcd/" 2>/dev/null || true
    chown root:root "$K3S_DATA_DIR/server/tls/etcd/"*
    chmod 600 "$K3S_DATA_DIR/server/tls/etcd/"*.key 2>/dev/null || true
    chmod 644 "$K3S_DATA_DIR/server/tls/etcd/"*.crt 2>/dev/null || true
    log_success "Etcd certificates restored"
fi

# Restore server token
if [ -f "$BACKUP_DIR/server/token" ]; then
    log_info "Restoring server token..."
    mkdir -p "$K3S_DATA_DIR/server"
    cp -v "$BACKUP_DIR/server/token" "$K3S_DATA_DIR/server/" 2>/dev/null || true
    chown root:root "$K3S_DATA_DIR/server/token"
    chmod 600 "$K3S_DATA_DIR/server/token"
    log_success "Server token restored"
fi

# Restore agent certificates
if [ -d "$BACKUP_DIR/agent" ]; then
    log_info "Restoring agent certificates..."
    mkdir -p "$K3S_DATA_DIR/agent"
    # Only restore CA certificates and kubelet certificates (not all client certs)
    for cert in client-ca.crt server-ca.crt client-kubelet.crt client-kubelet.key serving-kubelet.crt serving-kubelet.key; do
        if [ -f "$BACKUP_DIR/agent/$cert" ]; then
            cp -v "$BACKUP_DIR/agent/$cert" "$K3S_DATA_DIR/agent/" 2>/dev/null || true
        fi
    done
    chown -R root:root "$K3S_DATA_DIR/agent/"*.crt "$K3S_DATA_DIR/agent/"*.key 2>/dev/null || true
    chmod 600 "$K3S_DATA_DIR/agent/"*.key 2>/dev/null || true
    chmod 600 "$K3S_DATA_DIR/agent/"*.crt 2>/dev/null || true
    log_success "Agent certificates restored"
fi

echo

# Step 4: Start K3s
log_info "Step 4/5: Starting K3s..."
systemctl start k3s
sleep 5

# Wait for K3s to be ready
log_info "Waiting for K3s to be ready..."
TIMEOUT=60
ELAPSED=0
until kubectl get nodes 2>/dev/null; do
    if [ $ELAPSED -ge $TIMEOUT ]; then
        log_error "Timeout waiting for K3s to be ready"
        exit 1
    fi
    echo -n "."
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done
echo
log_success "K3s is ready"
echo

# Step 5: Restore kubeconfig
log_info "Step 5/5: Restoring kubeconfig..."

# Restore k3s.yaml (master kubeconfig)
if [ -f "$BACKUP_DIR/kubeconfigs/k3s.yaml" ]; then
    log_info "Restoring /etc/rancher/k3s/k3s.yaml from backup..."
    mkdir -p /etc/rancher/k3s
    cp "$BACKUP_DIR/kubeconfigs/k3s.yaml" /etc/rancher/k3s/k3s.yaml
    chown root:root /etc/rancher/k3s/k3s.yaml
    chmod 644 /etc/rancher/k3s/k3s.yaml
    log_success "k3s.yaml restored from backup"
fi

# Restore user kubeconfig
if [ -n "${SUDO_USER:-}" ]; then
    USER_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    
    if [ -f "$BACKUP_DIR/kubeconfigs/config" ]; then
        # Use backed-up kubeconfig
        log_info "Restoring backed-up kubeconfig for user $SUDO_USER..."
        mkdir -p "$USER_HOME/.kube"
        cp "$BACKUP_DIR/kubeconfigs/config" "$USER_HOME/.kube/config"
        chown -R "$SUDO_USER:$SUDO_USER" "$USER_HOME/.kube"
        log_success "Backed-up kubeconfig restored to $USER_HOME/.kube/config"
    else
        log_warn "No backed-up kubeconfig found, skipping user kubeconfig restoration"
    fi
fi

echo

# Verification
log_info "Verification:"
kubectl version --short 2>/dev/null || kubectl version 2>/dev/null || true
echo
kubectl get nodes
echo

log_success "K3s restoration complete!"
echo
log_info "Your K3s cluster should now have the same certificates and credentials as before"
log_info "Your existing kubeconfig files should continue to work"
