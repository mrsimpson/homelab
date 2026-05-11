#!/usr/bin/env bash
#
# setup-homelab-apps.sh — Bootstrap the homelab-apps GitHub repository.
#
# This one-time script:
#   1. Creates the mrsimpson/homelab-apps repository on GitHub
#   2. Sets PULUMI_ACCESS_TOKEN from ~/.pulumi/credentials.json
#   3. Generates a namespace-scoped KUBECONFIG for the lobehub namespace
#      (requires kubectl pointing at the cluster and the lobehub namespace to exist)
#   4. Prompts interactively for Tailscale OAuth credentials
#      (obtain from https://login.tailscale.com/admin/settings/oauth)
#
# Prerequisites:
#   - gh CLI authenticated with repo + secret write permissions
#   - kubectl configured and pointing at the homelab cluster
#   - lobehub namespace already exists (run `pulumi up` in apps/lobehub first if not)
#   - ~/.pulumi/credentials.json exists (run `pulumi login` if not)
#
# Usage:
#   ./scripts/setup-homelab-apps.sh [--repo mrsimpson/homelab-apps] [--skip-repo]
#
# Options:
#   --repo <owner/name>   Target GitHub repo (default: mrsimpson/homelab-apps)
#   --skip-repo           Skip repo creation (repo already exists)
#       --skip-kubeconfig     Skip kubeconfig generation (set KUBECONFIG secret manually)
#   TAILSCALE_IP          Tailscale IP of the cluster node (default: 100.70.179.36).
#                         The kubeconfig server URL is set to https://<TAILSCALE_IP>:6443
#                         so CI runners can reach the cluster via the tailnet.
#   --dry-run             Print what would be done without executing
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

REPO="${HOMELAB_APPS_REPO:-mrsimpson/homelab-apps}"
SKIP_REPO=false
SKIP_KUBECONFIG=false
DRY_RUN=false
NAMESPACE="lobehub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Tailscale IP of the cluster node — used to override the server URL in the generated
# kubeconfig. CI runners join the tailnet via tailscale/github-action and cannot
# reach the cluster via the local LAN IP. The Tailscale IP is stable for the device.
# Override with: TAILSCALE_IP=<ip> ./scripts/setup-homelab-apps.sh
TAILSCALE_IP="${TAILSCALE_IP:-100.70.179.36}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function info()  { echo "[INFO]  $*"; }
function step()  { echo; echo "==> $*"; }
function warn()  { echo "[WARN]  $*" >&2; }
function error() { echo "[ERROR] $*" >&2; exit 1; }

function run() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)            REPO="$2";           shift 2 ;;
    --skip-repo)       SKIP_REPO=true;      shift ;;
    --skip-kubeconfig) SKIP_KUBECONFIG=true; shift ;;
    --dry-run)         DRY_RUN=true;        shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) error "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------

step "Preflight checks"

if ! command -v gh &>/dev/null; then
  error "gh CLI not found. Install from https://cli.github.com/"
fi

if ! gh auth status &>/dev/null; then
  error "gh CLI not authenticated. Run: gh auth login"
fi

if ! command -v jq &>/dev/null; then
  error "jq not found. Install: brew install jq"
fi

PULUMI_CREDS="${HOME}/.pulumi/credentials.json"
if [[ ! -f "${PULUMI_CREDS}" ]]; then
  error "~/.pulumi/credentials.json not found. Run: pulumi login"
fi

info "gh CLI authenticated"
info "Pulumi credentials found at ${PULUMI_CREDS}"
info "Target repository: ${REPO}"

# ---------------------------------------------------------------------------
# Step 1: Create GitHub repository
# ---------------------------------------------------------------------------

if [[ "${SKIP_REPO}" == "false" ]]; then
  step "Creating GitHub repository: ${REPO}"

  if gh repo view "${REPO}" &>/dev/null; then
    warn "Repository ${REPO} already exists — skipping creation"
  else
    run gh repo create "${REPO}" \
      --public \
      --description "Personal homelab app deployments — Pulumi stacks consuming homelab-core-components" \
      --homepage "https://github.com/mrsimpson/homelab"
    info "Repository ${REPO} created"
  fi
else
  info "Skipping repo creation (--skip-repo)"
fi

# ---------------------------------------------------------------------------
# Step 2: PULUMI_ACCESS_TOKEN
# ---------------------------------------------------------------------------

step "Setting PULUMI_ACCESS_TOKEN secret"

PULUMI_TOKEN=$(jq -r '.accessTokens | to_entries | .[0].value' "${PULUMI_CREDS}" 2>/dev/null || true)

if [[ -z "${PULUMI_TOKEN}" || "${PULUMI_TOKEN}" == "null" ]]; then
  # Fallback: some credential files use .current + .tokens
  CURRENT_BACKEND=$(jq -r '.current' "${PULUMI_CREDS}" 2>/dev/null || true)
  if [[ -n "${CURRENT_BACKEND}" && "${CURRENT_BACKEND}" != "null" ]]; then
    PULUMI_TOKEN=$(jq -r --arg backend "${CURRENT_BACKEND}" '.accessTokens[$backend]' "${PULUMI_CREDS}" 2>/dev/null || true)
  fi
fi

if [[ -z "${PULUMI_TOKEN}" || "${PULUMI_TOKEN}" == "null" ]]; then
  error "Could not extract access token from ${PULUMI_CREDS}. Run 'pulumi login' to re-authenticate."
fi

run gh secret set PULUMI_ACCESS_TOKEN \
  --repo "${REPO}" \
  --body "${PULUMI_TOKEN}"
info "PULUMI_ACCESS_TOKEN set"

# ---------------------------------------------------------------------------
# Step 3: KUBECONFIG
# ---------------------------------------------------------------------------

if [[ "${SKIP_KUBECONFIG}" == "false" ]]; then
  step "Generating namespace-scoped KUBECONFIG for namespace: ${NAMESPACE}"

  if ! command -v kubectl &>/dev/null; then
    warn "kubectl not found — skipping KUBECONFIG generation. Set the secret manually:"
    warn "  base64 -w0 <kubeconfig-file> | gh secret set KUBECONFIG --repo ${REPO}"
  elif ! kubectl cluster-info &>/dev/null; then
    warn "kubectl cannot reach the cluster (Tailscale active?). Skipping KUBECONFIG generation."
    warn "  Re-run later with: KUBECONFIG_OUT=/tmp/lobehub-ci.kubeconfig ${SCRIPT_DIR}/create-kubeconfig.sh ${NAMESPACE}"
    warn "  Then: base64 -w0 /tmp/lobehub-ci.kubeconfig | gh secret set KUBECONFIG --repo ${REPO}"
  else
    KUBECONFIG_OUT="/tmp/${NAMESPACE}-ci.kubeconfig"
    # Pass SERVER_OVERRIDE so the generated kubeconfig uses the Tailscale IP.
    # CI runners connect via Tailscale; the LAN IP (in the local kubectl context) won't work.
    export SERVER_OVERRIDE="https://${TAILSCALE_IP}:6443"
    run bash "${SCRIPT_DIR}/create-kubeconfig.sh" "${NAMESPACE}"
    unset SERVER_OVERRIDE
    KUBECONFIG_B64=$(base64 -w0 "${KUBECONFIG_OUT}" 2>/dev/null || base64 "${KUBECONFIG_OUT}")
    run gh secret set KUBECONFIG \
      --repo "${REPO}" \
      --body "${KUBECONFIG_B64}"
    info "KUBECONFIG set from ${KUBECONFIG_OUT}"
  fi
else
  info "Skipping KUBECONFIG generation (--skip-kubeconfig)"
fi

# ---------------------------------------------------------------------------
# Step 4: Tailscale OAuth credentials (interactive)
# ---------------------------------------------------------------------------

step "Tailscale OAuth credentials"
echo
echo "  Open the Tailscale admin console to create or copy an OAuth client:"
echo "  https://login.tailscale.com/admin/settings/oauth"
echo
echo "  The client needs the 'auth_keys' scope and the 'tag:ci' tag."
echo "  (press Ctrl-C to abort and set TS_OAUTH_CLIENT_ID / TS_OAUTH_CLIENT_SECRET manually)"
echo

read -r -p "  Enter TS_OAUTH_CLIENT_ID  : " TS_CLIENT_ID
if [[ -z "${TS_CLIENT_ID}" ]]; then
  warn "Empty TS_OAUTH_CLIENT_ID — skipping Tailscale secrets. Set them manually:"
  warn "  gh secret set TS_OAUTH_CLIENT_ID  --repo ${REPO}"
  warn "  gh secret set TS_OAUTH_CLIENT_SECRET --repo ${REPO}"
else
  read -r -s -p "  Enter TS_OAUTH_CLIENT_SECRET: " TS_CLIENT_SECRET
  echo  # newline after silent input
  if [[ -z "${TS_CLIENT_SECRET}" ]]; then
    warn "Empty TS_OAUTH_CLIENT_SECRET — setting only the ID"
    run gh secret set TS_OAUTH_CLIENT_ID --repo "${REPO}" --body "${TS_CLIENT_ID}"
  else
    run gh secret set TS_OAUTH_CLIENT_ID     --repo "${REPO}" --body "${TS_CLIENT_ID}"
    run gh secret set TS_OAUTH_CLIENT_SECRET --repo "${REPO}" --body "${TS_CLIENT_SECRET}"
    info "TS_OAUTH_CLIENT_ID and TS_OAUTH_CLIENT_SECRET set"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

step "Done!"
echo
echo "  Repository : https://github.com/${REPO}"
echo "  Secrets    : $(gh secret list --repo "${REPO}" 2>/dev/null | awk '{print $1}' | tr '\n' ' ' || echo "(check manually)")"
echo
echo "Next steps:"
echo "  1. Clone the repo:   gh repo clone ${REPO} ~/projects/privat/homelab-apps"
echo "  2. Push the scaffolded content to main"
echo "  3. Trigger a deploy: gh workflow run deploy-lobehub.yml --repo ${REPO}"
