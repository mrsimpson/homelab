#!/bin/bash

set -euo pipefail

#
# K3s Complete Reset Script
#
# This script performs a complete k3s reset cycle:
# 1. Backs up certificates and credentials
# 2. Uninstalls k3s completely
# 3. Reinstalls k3s fresh
# 4. Restores certificates and credentials
#
# Result: Clean k3s installation with preserved certificates
# so your existing kubeconfig files continue to work
#

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
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

log_step() {
    echo -e "${CYAN}${BOLD}=== $* ===${NC}"
}

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root (sudo ./reset-k3s.sh)"
    exit 1
fi

echo ""
log_step "K3s Complete Reset"
echo ""
log_info "This script will:"
echo "  1. Back up your k3s certificates and credentials"
echo "  2. Completely uninstall k3s"
echo "  3. Reinstall k3s fresh"
echo "  4. Restore your certificates and credentials"
echo ""
log_success "Result: Fresh k3s with preserved certificates"
log_info "Your existing kubeconfig files will continue to work"
echo ""

log_warn "This will temporarily stop your k3s cluster"
read -p "Continue with reset? (yes/no): " -r CONFIRM
if [[ ! $CONFIRM =~ ^[Yy][Ee][Ss]$ ]]; then
    log_info "Cancelled"
    exit 0
fi
echo ""

# Step 1: Uninstall (with backup)
log_step "Step 1/2: Uninstalling k3s and backing up certificates"
echo ""

if [ -f "$SCRIPT_DIR/uninstall-k3s.sh" ]; then
    # Run uninstall script non-interactively
    echo "yes" | bash "$SCRIPT_DIR/uninstall-k3s.sh"
    
    if [ $? -ne 0 ]; then
        log_error "Uninstall failed"
        exit 1
    fi
else
    log_error "Uninstall script not found: $SCRIPT_DIR/uninstall-k3s.sh"
    exit 1
fi

echo ""
log_success "Step 1 complete: k3s uninstalled, certificates backed up"
echo ""
sleep 2

# Step 2: Reinstall with restoration
log_step "Step 2/2: Reinstalling k3s and restoring certificates"
echo ""

if [ -f "$SCRIPT_DIR/install-k3s.sh" ]; then
    # Run install script with --restore flag
    bash "$SCRIPT_DIR/install-k3s.sh" --restore
    
    if [ $? -ne 0 ]; then
        log_error "Installation failed"
        exit 1
    fi
else
    log_error "Install script not found: $SCRIPT_DIR/install-k3s.sh"
    exit 1
fi

echo ""
log_success "Step 2 complete: k3s reinstalled, certificates restored"
echo ""

# Final verification
log_step "Verification"
echo ""

log_info "K3s version:"
k3s --version | head -n 1
echo ""

log_info "Cluster status:"
kubectl get nodes
echo ""

log_info "System pods:"
kubectl get pods -n kube-system
echo ""

log_step "Reset Complete!"
echo ""
log_success "Your k3s cluster has been completely reset"
log_success "All certificates and credentials have been preserved"
log_success "Your existing kubeconfig files should continue to work"
echo ""
log_info "Next steps:"
echo "  - Deploy your applications"
echo "  - See docs/howto/setup-cluster.md for Pulumi setup"
echo ""
