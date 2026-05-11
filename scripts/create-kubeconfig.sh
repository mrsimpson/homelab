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
#   SERVER_OVERRIDE   Override the cluster server URL (e.g. https://100.70.179.36:6443).
#                     Useful when your local kubectl context points to the LAN IP but CI
#                     runners must reach the cluster via the Tailscale IP instead.
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
  SERVER_OVERRIDE   Override the cluster server URL written into the kubeconfig.
                    Use this when your local kubectl context uses the LAN IP but
                    CI runners must connect via the Tailscale IP (100.x.x.x).
                    Example: SERVER_OVERRIDE=https://100.70.179.36:6443

Examples:
  # Basic usage (namespace: my-app, SA: ci)
  ./scripts/create-kubeconfig.sh my-app

  # Generate kubeconfig with Tailscale IP for CI (local kubectl uses LAN IP)
  SERVER_OVERRIDE=https://100.70.179.36:6443 ./scripts/create-kubeconfig.sh lobehub

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

# Step 3: Create ClusterRole (idempotent)
#
# RBAC design — two layers:
#
#   ClusterRole homelab-ci-deployer  (cluster-scoped resources + CRDs only)
#     Granted cluster-wide so Pulumi can GET Namespace objects and read/write CRDs
#     (Traefik, CNPG, ExternalSecrets, Gateway) regardless of which namespace an app
#     is in. Does NOT include Secrets or RBAC write access — those are too broad at
#     cluster scope.
#
#   Role homelab-ci-secrets  (per namespace, created in Step 4)
#     Grants Secrets CRUD and RBAC write within one namespace only. This limits the
#     blast radius of a leaked kubeconfig: an attacker can only read/write secrets
#     in the namespaces this SA is bound to, not cluster-wide.
#
# For a monorepo deploying multiple apps: run create-kubeconfig.sh once per app
# namespace. Each run creates the per-namespace Role+RoleBinding. The ClusterRole
# and ClusterRoleBinding are shared (idempotent creates).
CLUSTERROLE_NAME="homelab-ci-deployer"
step "Creating ClusterRole '${CLUSTERROLE_NAME}'..."
if kubectl get clusterrole "${CLUSTERROLE_NAME}" &> /dev/null; then
    info "ClusterRole '${CLUSTERROLE_NAME}' already exists — skipping (apply manually to update rules)"
else
    kubectl create -f - <<EOF || error "Failed to create ClusterRole"
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${CLUSTERROLE_NAME}
  labels:
    app.kubernetes.io/managed-by: homelab-create-kubeconfig
rules:
# Namespaces — cluster-scoped; Pulumi needs GET/LIST during refresh
- apiGroups: [""]
  resources: [namespaces]
  verbs: [get, list, watch, create, update, patch, delete]
# Core namespace-scoped resources (excluding secrets — see per-namespace Role)
- apiGroups: [""]
  resources:
  - pods
  - pods/log
  - pods/status
  - services
  - configmaps
  - persistentvolumeclaims
  - serviceaccounts
  - events
  verbs: [get, list, watch, create, update, patch, delete]
# Apps resources
- apiGroups: ["apps"]
  resources: [deployments, replicasets, statefulsets, daemonsets]
  verbs: [get, list, watch, create, update, patch, delete]
# Batch resources
- apiGroups: ["batch"]
  resources: [jobs, cronjobs]
  verbs: [get, list, watch, create, update, patch, delete]
# Networking
- apiGroups: ["networking.k8s.io"]
  resources: [ingresses]
  verbs: [get, list, watch, create, update, patch, delete]
# Traefik CRDs (IngressRoute, Middleware, etc.)
- apiGroups: ["traefik.io", "traefik.containo.us"]
  resources: ["*"]
  verbs: [get, list, watch, create, update, patch, delete]
# CloudNativePG (CNPG) CRDs
- apiGroups: ["postgresql.cnpg.io"]
  resources: ["*"]
  verbs: [get, list, watch, create, update, patch, delete]
# External Secrets Operator CRDs
- apiGroups: ["external-secrets.io"]
  resources: ["*"]
  verbs: [get, list, watch, create, update, patch, delete]
# Gateway API (HTTPRoute, Gateway, etc.)
- apiGroups: ["gateway.networking.k8s.io"]
  resources: ["*"]
  verbs: [get, list, watch, create, update, patch, delete]
EOF
    info "ClusterRole '${CLUSTERROLE_NAME}' created"
fi

# Step 4: Create ClusterRoleBinding (idempotent)
# Binding name is unique per SA to allow multiple apps with separate SAs.
CLUSTERROLEBINDING_NAME="${CLUSTERROLE_NAME}:${NAMESPACE}:${SA_NAME}"
step "Creating ClusterRoleBinding '${CLUSTERROLEBINDING_NAME}'..."
if kubectl get clusterrolebinding "${CLUSTERROLEBINDING_NAME}" &> /dev/null; then
    info "ClusterRoleBinding '${CLUSTERROLEBINDING_NAME}' already exists"
else
    kubectl create -f - <<EOF || error "Failed to create ClusterRoleBinding"
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${CLUSTERROLEBINDING_NAME}
  labels:
    app.kubernetes.io/managed-by: homelab-create-kubeconfig
subjects:
- kind: ServiceAccount
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
roleRef:
  kind: ClusterRole
  name: ${CLUSTERROLE_NAME}
  apiGroup: rbac.authorization.k8s.io
EOF
    info "ClusterRoleBinding '${CLUSTERROLEBINDING_NAME}' created"
fi

# Step 5: Create per-namespace Role for Secrets + RBAC (idempotent)
#
# Secrets and RBAC write access are scoped to this namespace only.
# This limits the blast radius if the kubeconfig is ever leaked:
# an attacker can only read/write secrets within this app's namespace.
SECRETS_ROLE_NAME="homelab-ci-secrets"
step "Creating namespace Role '${SECRETS_ROLE_NAME}' in namespace '${NAMESPACE}'..."
if kubectl get role "${SECRETS_ROLE_NAME}" -n "${NAMESPACE}" &> /dev/null; then
    info "Role '${SECRETS_ROLE_NAME}' already exists — skipping (apply manually to update rules)"
else
    kubectl create -n "${NAMESPACE}" -f - <<EOF || error "Failed to create namespace Role"
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${SECRETS_ROLE_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: homelab-create-kubeconfig
rules:
# Secrets — scoped to this namespace only (NOT cluster-wide)
- apiGroups: [""]
  resources: [secrets]
  verbs: [get, list, watch, create, update, patch, delete]
# RBAC within namespace — Pulumi may manage Roles for the app
- apiGroups: ["rbac.authorization.k8s.io"]
  resources: [roles, rolebindings]
  verbs: [get, list, watch, create, update, patch, delete]
EOF
    info "Role '${SECRETS_ROLE_NAME}' created in namespace '${NAMESPACE}'"
fi

# Step 6: Create per-namespace RoleBinding for Secrets Role (idempotent)
SECRETS_ROLEBINDING_NAME="${SECRETS_ROLE_NAME}:${SA_NAME}"
step "Creating RoleBinding '${SECRETS_ROLEBINDING_NAME}' in namespace '${NAMESPACE}'..."
if kubectl get rolebinding "${SECRETS_ROLEBINDING_NAME}" -n "${NAMESPACE}" &> /dev/null; then
    info "RoleBinding '${SECRETS_ROLEBINDING_NAME}' already exists"
else
    kubectl create -n "${NAMESPACE}" -f - <<EOF || error "Failed to create namespace RoleBinding"
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SECRETS_ROLEBINDING_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: homelab-create-kubeconfig
subjects:
- kind: ServiceAccount
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
roleRef:
  kind: Role
  name: ${SECRETS_ROLE_NAME}
  apiGroup: rbac.authorization.k8s.io
EOF
    info "RoleBinding '${SECRETS_ROLEBINDING_NAME}' created in namespace '${NAMESPACE}'"
fi
# Step 7: Get or create long-lived token Secret
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

# Step 8: Get cluster info
step "Getting cluster server URL..."
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA_DATA=$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

# Allow overriding the server URL for CI kubeconfigs.
# Use this when the local kubectl context points to the LAN IP (e.g. 192.168.x.x)
# but CI runners must reach the cluster via the Tailscale IP (100.x.x.x).
if [[ -n "${SERVER_OVERRIDE:-}" ]]; then
    info "SERVER_OVERRIDE set — replacing server URL:"
    info "  original : ${SERVER}"
    info "  override : ${SERVER_OVERRIDE}"
    SERVER="${SERVER_OVERRIDE}"
fi

# Step 9: Write kubeconfig
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
