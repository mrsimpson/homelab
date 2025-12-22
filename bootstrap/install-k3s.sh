#!/bin/bash
set -euo pipefail

#
# k3s Installation Script for Homelab
#
# This script installs k3s (lightweight Kubernetes) on Ubuntu
# Run as: sudo ./install-k3s.sh
#

echo "🚀 Installing k3s..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (sudo ./install-k3s.sh)"
  exit 1
fi

# Install k3s with custom configuration
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --disable servicelb \
  --secrets-encryption

echo "⏳ Waiting for k3s to be ready..."
sleep 10

# Wait for k3s to be fully ready
until kubectl get nodes 2>/dev/null; do
  echo "Waiting for kubectl..."
  sleep 2
done

# Verify installation
echo ""
echo "✅ k3s installed successfully!"
echo ""
kubectl get nodes
echo ""

# Setup kubeconfig for non-root user
if [ -n "${SUDO_USER:-}" ]; then
  echo "📝 Setting up kubeconfig for user $SUDO_USER..."

  USER_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
  mkdir -p "$USER_HOME/.kube"
  cp /etc/rancher/k3s/k3s.yaml "$USER_HOME/.kube/config"
  chown -R "$SUDO_USER:$SUDO_USER" "$USER_HOME/.kube"

  echo "✅ Kubeconfig copied to $USER_HOME/.kube/config"
fi

echo ""
echo "🎉 k3s is ready!"
echo ""
echo "Next steps:"
echo "  1. Install Pulumi: curl -fsSL https://get.pulumi.com | sh"
echo "  2. Install Node.js 24: See docs/howto/setup-cluster.md"
echo "  3. Login to Pulumi Cloud: pulumi login"
echo "  4. Deploy infrastructure: cd infrastructure && pulumi up"
