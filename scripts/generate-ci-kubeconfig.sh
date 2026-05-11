#!/usr/bin/env bash
#
# generate-ci-kubeconfig.sh — Generate a CI kubeconfig for a homelab-apps namespace.
#
# Wraps create-kubeconfig.sh (in the same scripts/ directory) with CI-specific
# defaults: requires the Tailscale server URL so the generated kubeconfig works
# from GitHub Actions runners on the tailnet.
#
# Usage:
#   SERVER_OVERRIDE=https://<tailscale-hostname-or-ip>:6443 \
#     ./scripts/generate-ci-kubeconfig.sh <namespace>
#
#   Find your Tailscale hostname: tailscale status --json | jq -r '.Self.DNSName'
#   Find your Tailscale IP:       tailscale ip -4
#
# Arguments:
#   namespace    Kubernetes namespace (required)
#
# Environment Variables:
#   SERVER_OVERRIDE   Tailscale server URL for the cluster API (required).
#                     Must point to the Tailscale address — the local LAN IP
#                     is not reachable from GitHub Actions runners.
#   KUBECONFIG_OUT    Output path (default: /tmp/<namespace>-ci.kubeconfig)
#
set -euo pipefail

NAMESPACE="${1:-}"
if [[ -z "${NAMESPACE}" ]]; then
    echo "Usage: SERVER_OVERRIDE=https://<tailscale-host>:6443 $0 <namespace>" >&2
    exit 1
fi

if [[ -z "${SERVER_OVERRIDE:-}" ]]; then
    echo "Error: SERVER_OVERRIDE is required." >&2
    echo "  Find your Tailscale hostname: tailscale status --json | jq -r '.Self.DNSName'" >&2
    echo "  Find your Tailscale IP:       tailscale ip -4" >&2
    echo "  Then re-run: SERVER_OVERRIDE=https://<host>:6443 $0 ${NAMESPACE}" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATE_SCRIPT="${SCRIPT_DIR}/create-kubeconfig.sh"

if [[ ! -f "${CREATE_SCRIPT}" ]]; then
    echo "Error: create-kubeconfig.sh not found at '${CREATE_SCRIPT}'" >&2
    exit 1
fi

echo "[INFO] Generating CI kubeconfig"
echo "[INFO]   Namespace      : ${NAMESPACE}"
echo "[INFO]   SERVER_OVERRIDE: ${SERVER_OVERRIDE}"
echo ""

export SERVER_OVERRIDE
bash "${CREATE_SCRIPT}" "${NAMESPACE}"
