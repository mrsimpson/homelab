#!/usr/bin/env bash
#
# create-kubeconfig.sh — Create a kubeconfig for CI deployments to the homelab cluster.
#
# This script:
#   1. Verifies the namespace exists
#   2. Creates a ServiceAccount (if it doesn't exist)
#   3. Creates a Role with typical CI deployment permissions (if it doesn't exist)
#   4. Creates a RoleBinding (if it doesn't exist)
#   5. Generates a token and writes a kubeconfig file
#
# Prerequisites:
#   - kubectl configured and pointing at the homelab cluster
#   - Namespace already exists (created via pulumi up)
#
# Usage:
#   ./scripts/create-kubeconfig.sh <namespace> [sa-name]
#
# Arguments:
#   namespace    (required) Kubernetes namespace for the app
#   sa-name     (optional) ServiceAccount name (default: ci)
#
# Environment Variables:
#   KUBECONFIG_OUT    Output path for kubeconfig (default: /tmp/<namespace>-ci.kubeconfig)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SA_NAME="${SA_NAME:-ci}"

function usage() {
    cat <<EOF
Usage: $(basename "$0") <namespace> [sa-name]

Create a kubeconfig for CI deployments to the homelab cluster.

Arguments:
  namespace    Kubernetes namespace for the app (required)
  sa-name      ServiceAccount name (optional, default: ci)

Environment Variables:
  KUBECONFIG_OUT    Output path for kubeconfig (default: /tmp/<namespace>-ci.kubeconfig)

Examples:
  # Basic usage (namespace: my-app, SA: ci)
  ./scripts/create-kubeconfig.sh my-app

  # Custom SA name for special apps
  ./scripts/create-kubeconfig.sh code opencode-router

  # Custom output path
  KUBECONFIG_OUT=/tmp/my.kubeconfig ./scripts/create-kubeconfig.sh my-app

First-time setup:
  1. Run 'pulumi up' locally to create the namespace
  2. Run this script to create the ServiceAccount and kubeconfig
  3. Copy the kubeconfig to your CI secrets

EOF
}

function error() {
    echo "Error: $*" >&2
    exit 1
}

function info() {
    echo "[INFO] $*"
}

function step() {
    echo "[STEP] $*"
}

# Parse arguments
NAMESPACE="${1:-${NAMESPACE:-}}"

if [[ -z "${NAMESPACE}" ]]; then
    usage
    error "namespace is required"
fi

if [[ -n "${2:-}" ]]; then
    SA_NAME="$2"
fi

KUBECONFIG_OUT="${KUBECONFIG_OUT:-/tmp/${NAMESPACE}-ci.kubeconfig}"

# Verify kubectl is available
if ! command -v kubectl &> /dev/null; then
    error "kubectl not found. Please install kubectl and configure access to the cluster."
fi

# Verify kubectl can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    error "kubectl cannot connect to the cluster. Check your kubeconfig."
fi

# Step 1: Verify namespace exists
step "Verifying namespace '${NAMESPACE}' exists..."
if ! kubectl get namespace "${NAMESPACE}" &> /dev/null; then
    error "Namespace '${NAMESPACE}' does not exist. Run 'pulumi up' in your app's deployment directory first."
fi

# Step 2: Create ServiceAccount (idempotent)
step "Creating ServiceAccount '${SA_NAME}' in namespace '${NAMESPACE}'..."
if kubectl get sa "${SA_NAME}" -n "${NAMESPACE}" &> /dev/null; then
    info "ServiceAccount '${SA_NAME}' already exists"
else
    kubectl create sa "${SA_NAME}" -n "${NAMESPACE}"
    info "ServiceAccount '${SA_NAME}' created"
fi

# Step 3: Create Role (idempotent)
ROLE_NAME="${SA_NAME}"
step "Creating Role '${ROLE_NAME}' in namespace '${NAMESPACE}'..."
if kubectl get role "${ROLE_NAME}" -n "${NAMESPACE}" &> /dev/null; then
    info "Role '${ROLE_NAME}' already exists"
else
    kubectl create -n "${NAMESPACE}" -f - <<EOF || error "Failed to create role"
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${ROLE_NAME}
rules:
- apiGroups: ["", "apps", "networking.k8s.io"]
  resources:
  - pods
  - pods/log
  - pods/status
  - services
  - services/status
  - configmaps
  - configmaps/status
  - secrets
  - secrets/status
  - ingresses
  - ingresses/status
  - deployments
  - deployments/status
  - replicasets
  - replicasets/status
  - statefulsets
  - statefulsets/status
  - jobs
  - jobs/status
  - cronjobs
  - cronjobs/status
  verbs:
  - get
  - list
  - watch
  - create
  - update
  - patch
  - delete
- apiGroups: [""]
  resources:
  - pods/exec
  - pods/attach
  verbs:
  - create
  - delete
- apiGroups: [""]
  resources:
  - events
  verbs:
  - get
  - list
  - watch
EOF
    info "Role '${ROLE_NAME}' created"
fi

# Step 4: Create RoleBinding (idempotent)
ROLEBINDING_NAME="${SA_NAME}"
step "Creating RoleBinding '${ROLEBINDING_NAME}' in namespace '${NAMESPACE}'..."
if kubectl get rolebinding "${ROLEBINDING_NAME}" -n "${NAMESPACE}" &> /dev/null; then
    info "RoleBinding '${ROLEBINDING_NAME}' already exists"
else
    kubectl create -n "${NAMESPACE}" -f - <<EOF || error "Failed to create rolebinding"
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${ROLEBINDING_NAME}
subjects:
- kind: ServiceAccount
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
roleRef:
  kind: Role
  name: ${ROLE_NAME}
  apiGroup: rbac.authorization.k8s.io
EOF
    info "RoleBinding '${ROLEBINDING_NAME}' created"
fi

# Step 5: Get or create long-lived token Secret
step "Getting token for ServiceAccount '${SA_NAME}'..."
SECRET_NAME="${SA_NAME}-token"

if kubectl get secret "${SECRET_NAME}" -n "${NAMESPACE}" &> /dev/null; then
    info "Token Secret '${SECRET_NAME}' already exists"
else
    step "Creating token Secret '${SECRET_NAME}'..."
    kubectl create -n "${NAMESPACE}" -f - <<EOF || error "Failed to create token secret"
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  annotations:
    kubernetes.io/service-account.name: ${SA_NAME}
type: kubernetes.io/service-account-token
EOF
    info "Token Secret created — Kubernetes will populate it shortly"
fi

step "Waiting for token to be populated (can take a few seconds)..."
for i in {1..30}; do
    TOKEN_READY=$(kubectl get secret "${SECRET_NAME}" -n "${NAMESPACE}" -o jsonpath='{.data.token}' 2>/dev/null || echo "")
    if [[ -n "${TOKEN_READY}" ]]; then
        break
    fi
    sleep 1
done

if [[ -z "${TOKEN_READY}" ]]; then
    error "Token was not populated in Secret '${SECRET_NAME}' after 30 seconds. Check kube-controller-manager."
fi

TOKEN=$(echo "${TOKEN_READY}" | base64 -d)

# Step 6: Get cluster info
step "Getting cluster server URL..."
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA_DATA=$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

# Step 7: Write kubeconfig
step "Writing kubeconfig to '${KUBECONFIG_OUT}'..."
cat > "${KUBECONFIG_OUT}" <<EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${CA_DATA}
    server: ${SERVER}
  name: homelab
contexts:
- context:
    cluster: homelab
    namespace: ${NAMESPACE}
    user: ${SA_NAME}-sa
  name: ${NAMESPACE}-ci
current-context: ${NAMESPACE}-ci
users:
- name: ${SA_NAME}-sa
  user:
    token: ${TOKEN}
EOF

info "Kubeconfig written to '${KUBECONFIG_OUT}'"
info ""
info "Next steps:"
info "  1. Copy '${KUBECONFIG_OUT}' to your CI secrets (e.g., KUBECONFIG secret)"
info "  2. Use the kubeconfig in your CI pipeline to run 'pulumi up'"
info ""
info "Token does not expire (long-lived Secret-based token)."
info "To revoke, delete the Secret: kubectl delete secret ${SECRET_NAME} -n ${NAMESPACE}"
