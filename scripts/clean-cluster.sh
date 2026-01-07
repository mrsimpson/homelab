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

log_info "Homelab Cluster Cleanup Script"
log_info "Project Root: $PROJECT_ROOT"
echo

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    log_error "kubectl not found. Please install kubectl first."
    exit 1
fi

# Check if connected to cluster
if ! kubectl cluster-info &> /dev/null; then
    log_error "Not connected to Kubernetes cluster"
    exit 1
fi

log_info "Connected to cluster at: $(kubectl cluster-info 2>&1 | grep 'Kubernetes master' | head -1)"
echo

# Confirm before proceeding
log_warn "This will destroy all Pulumi-managed resources in the cluster"
read -p "Continue? (yes/no): " -r CONFIRM
if [[ ! $CONFIRM =~ ^[Yy][Ee][Ss]$ ]]; then
    log_info "Cancelled"
    exit 0
fi
echo

# Step 1: Destroy Pulumi stack
log_info "Step 1/4: Destroying Pulumi stack..."
if ! cd "$PROJECT_ROOT" 2>/dev/null; then
    log_error "Failed to cd to project root: $PROJECT_ROOT"
    exit 1
fi

if command -v pulumi &> /dev/null; then
    if pulumi stack ls 2>/dev/null | grep -q "dev"; then
        log_info "Destroying stack 'dev'..."
        pulumi destroy --stack dev --yes --suppress-outputs 2>&1 | grep -v "^$" || true
        log_success "Pulumi stack destroyed"
    else
        log_warn "Stack 'dev' not found, skipping pulumi destroy"
    fi
else
    log_warn "pulumi not found, skipping pulumi destroy"
fi
echo

# Step 2: Handle stuck namespaces
log_info "Step 2/4: Cleaning up stuck namespaces..."

# Get all terminating namespaces
TERMINATING_NS=$(kubectl get ns -o json 2>/dev/null | \
    jq -r '.items[] | select(.status.phase=="Terminating") | .metadata.name' 2>/dev/null || true)

if [ -n "$TERMINATING_NS" ]; then
    log_warn "Found terminating namespaces: $TERMINATING_NS"
    
    while IFS= read -r ns; do
        if [ -z "$ns" ]; then
            continue
        fi
        
        log_info "Cleaning namespace: $ns"
        
        # Remove finalizers from CRD resources
        kubectl api-resources --namespaced -o name 2>/dev/null | while read -r resource; do
            kubectl get "$resource" -n "$ns" -o name 2>/dev/null | while read -r item; do
                kubectl -n "$ns" patch "$item" -p '{"metadata":{"finalizers":[]}}' --type merge 2>/dev/null || true
            done
        done
        
        # Remove finalizers from namespace itself
        kubectl patch ns "$ns" -p '{"spec":{"finalizers":[]}}' --type merge 2>/dev/null || true
        
        log_success "Cleaned namespace: $ns"
    done <<< "$TERMINATING_NS"
    
    log_info "Waiting for namespaces to be deleted..."
    sleep 10
else
    log_success "No terminating namespaces found"
fi
echo

# Step 3: Delete custom namespaces
log_info "Step 3/4: Deleting custom namespaces..."

CUSTOM_NS=$(kubectl get ns -o name 2>/dev/null | grep -v "default\|kube-" | sed 's|namespace/||' || true)

if [ -n "$CUSTOM_NS" ]; then
    while IFS= read -r ns; do
        if [ -z "$ns" ]; then
            continue
        fi
        
        log_info "Deleting namespace: $ns"
        kubectl delete ns "$ns" --ignore-not-found=true 2>/dev/null || true
    done <<< "$CUSTOM_NS"
    
    log_info "Waiting for namespaces to be deleted..."
    sleep 30
    
    log_success "Custom namespaces deleted"
else
    log_success "No custom namespaces found"
fi
echo

# Step 4: Verify cleanup
log_info "Step 4/4: Verifying cluster cleanup..."

REMAINING_NS=$(kubectl get ns -o name 2>/dev/null | grep -v "default\|kube-\|kube_system" | sed 's|namespace/||' || true)

if [ -n "$REMAINING_NS" ]; then
    log_warn "Warning: Some namespaces still remain:"
    kubectl get namespaces
    echo
    log_warn "You may need to manually clean these with:"
    echo "  kubectl delete ns <namespace> --grace-period=0 --force"
else
    log_success "All custom namespaces cleaned"
fi

echo

# Verify only system namespaces remain
log_info "Final namespace status:"
kubectl get namespaces
echo

log_success "Cluster cleanup complete!"
log_info "Next steps:"
echo "  1. Review the namespace list above"
echo "  2. If needed, clean stack with: pulumi stack rm dev --yes"
echo "  3. Create fresh stack with: pulumi stack init dev"
echo "  4. Redeploy with: pulumi up --stack dev --yes"
