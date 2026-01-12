#!/bin/bash
set -euo pipefail

#
# k3s Installation Script for Homelab
#
# This script installs k3s (lightweight Kubernetes) on Ubuntu
# Run as: sudo ./install-k3s.sh [--restore]
#
# Options:
#   --restore    After installation, restore certificates from backup
#

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/.k3s-backup"

# Parse arguments
RESTORE_MODE=false
if [[ "${1:-}" == "--restore" ]]; then
  RESTORE_MODE=true
  echo "🔄 Installation with certificate restoration enabled"
fi

echo "🚀 Installing k3s..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (sudo ./install-k3s.sh)"
  exit 1
fi

# Create k3s config directory
mkdir -p /etc/rancher/k3s

# Prepare token based on mode
if [ "$RESTORE_MODE" = true ]; then
  # First check if we have a backed-up config file
  if [ -f "$BACKUP_DIR/config/config.yaml" ]; then
    echo "🔑 Restoring config.yaml from backup..."
    cp "$BACKUP_DIR/config/config.yaml" /etc/rancher/k3s/config.yaml
    chown root:root /etc/rancher/k3s/config.yaml
    chmod 600 /etc/rancher/k3s/config.yaml
    echo "✅ Configuration file restored from backup"
    CONFIG_RESTORED=true
  elif [ -f "$BACKUP_DIR/server/token" ]; then
    # Fallback: use token from backup if config doesn't exist
    echo "🔑 Using token from backup..."
    INSTALL_TOKEN=$(cat "$BACKUP_DIR/server/token")
    CONFIG_RESTORED=false
  else
    echo "❌ No backup found - cannot restore"
    exit 1
  fi
else
  # Normal mode: generate new token
  echo "🔑 Generating new cluster token..."
  INSTALL_TOKEN="K10$(openssl rand -hex 32)::server:$(openssl rand -hex 16)"
  CONFIG_RESTORED=false
fi

# Create k3s config file with token (if not already restored)
if [ "$CONFIG_RESTORED" = false ]; then
  echo "📝 Creating k3s configuration file..."
  cat > /etc/rancher/k3s/config.yaml <<EOF
write-kubeconfig-mode: "644"
disable:
  - traefik
  - servicelb
secrets-encryption: true
token: "$INSTALL_TOKEN"
EOF
  echo "✅ Configuration file created with persistent token"
fi

# Install k3s with custom configuration
if [ "$RESTORE_MODE" = true ]; then
  # In restore mode: install but skip starting (we'll restore certs first)
  echo "📦 Installing k3s (without starting - will restore certificates first)..."
  curl -sfL https://get.k3s.io | INSTALL_K3S_SKIP_START=true sh -
else
  # Normal mode: install and start
  echo "📦 Installing k3s..."
  curl -sfL https://get.k3s.io | sh -

  echo "⏳ Waiting for k3s to be ready..."
  sleep 10

  # Wait for k3s to be fully ready
  until kubectl get nodes 2>/dev/null; do
    echo "Waiting for kubectl..."
    sleep 2
  done
fi

# Verify installation (only in non-restore mode, restore mode verifies later)
if [ "$RESTORE_MODE" = false ]; then
  echo ""
  echo "✅ k3s installed successfully!"
  echo ""
  kubectl get nodes
  echo ""
fi

# Setup kubeconfig for non-root user (only if NOT in restore mode)
if [ "$RESTORE_MODE" = false ] && [ -n "${SUDO_USER:-}" ]; then
  echo "📝 Setting up kubeconfig for user $SUDO_USER..."

  USER_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
  mkdir -p "$USER_HOME/.kube"
  cp /etc/rancher/k3s/k3s.yaml "$USER_HOME/.kube/config"
  chown -R "$SUDO_USER:$SUDO_USER" "$USER_HOME/.kube"

  echo "✅ Kubeconfig copied to $USER_HOME/.kube/config"
elif [ "$RESTORE_MODE" = true ]; then
  echo "⏭️  Skipping kubeconfig setup (restore mode - will restore from backup)"
fi

echo ""
echo "🎉 k3s is ready!"
echo ""

# Restore certificates if requested
if [ "$RESTORE_MODE" = true ]; then
  echo "🔄 Restoring certificates and credentials from backup..."
  
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "⚠️  Warning: Backup directory not found at $BACKUP_DIR"
    echo "    Skipping restoration. Run uninstall-k3s.sh first to create a backup."
  else
    # Clean the database to start fresh (it was encrypted with the new token)
    echo "🧹 Cleaning database (will be recreated with restored token)..."
    rm -rf /var/lib/rancher/k3s/server/db 2>/dev/null || true
    rm -rf /var/lib/rancher/k3s/server/cred 2>/dev/null || true
    echo "✅ Database cleaned"
    
    echo ""
    
    # Restore server TLS certificates
    if [ -d "$BACKUP_DIR/server/tls" ]; then
      echo "🔐 Restoring server TLS certificates..."
      mkdir -p /var/lib/rancher/k3s/server/tls
      cp "$BACKUP_DIR/server/tls/"* /var/lib/rancher/k3s/server/tls/ 2>/dev/null || true
      chown root:root /var/lib/rancher/k3s/server/tls/*
      chmod 600 /var/lib/rancher/k3s/server/tls/*.key 2>/dev/null || true
      chmod 644 /var/lib/rancher/k3s/server/tls/*.crt 2>/dev/null || true
      echo "✅ Server TLS certificates restored"
    fi
    
    # Restore etcd certificates
    if [ -d "$BACKUP_DIR/server/tls/etcd" ]; then
      echo "🔐 Restoring etcd certificates..."
      mkdir -p /var/lib/rancher/k3s/server/tls/etcd
      cp "$BACKUP_DIR/server/tls/etcd/"* /var/lib/rancher/k3s/server/tls/etcd/ 2>/dev/null || true
      chown root:root /var/lib/rancher/k3s/server/tls/etcd/*
      chmod 600 /var/lib/rancher/k3s/server/tls/etcd/*.key 2>/dev/null || true
      chmod 644 /var/lib/rancher/k3s/server/tls/etcd/*.crt 2>/dev/null || true
      echo "✅ Etcd certificates restored"
    fi
    
    # Note: Token is already configured in /etc/rancher/k3s/config.yaml (created above)
    # The token file at /var/lib/rancher/k3s/server/token will be auto-generated by k3s
    # from the config.yaml, so we don't need to restore it manually
    
    # Restore agent certificates
    if [ -d "$BACKUP_DIR/agent" ]; then
      echo "🔐 Restoring agent certificates..."
      mkdir -p /var/lib/rancher/k3s/agent
      for cert in client-ca.crt server-ca.crt client-kubelet.crt client-kubelet.key serving-kubelet.crt serving-kubelet.key; do
        if [ -f "$BACKUP_DIR/agent/$cert" ]; then
          cp "$BACKUP_DIR/agent/$cert" /var/lib/rancher/k3s/agent/ 2>/dev/null || true
        fi
      done
      chown -R root:root /var/lib/rancher/k3s/agent/*.crt /var/lib/rancher/k3s/agent/*.key 2>/dev/null || true
      chmod 600 /var/lib/rancher/k3s/agent/*.key 2>/dev/null || true
      chmod 600 /var/lib/rancher/k3s/agent/*.crt 2>/dev/null || true
      echo "✅ Agent certificates restored"
    fi
    
    # Restore k3s.yaml from backup (this is the master kubeconfig)
    if [ -f "$BACKUP_DIR/kubeconfigs/k3s.yaml" ]; then
      echo "📝 Restoring /etc/rancher/k3s/k3s.yaml from backup..."
      mkdir -p /etc/rancher/k3s
      cp "$BACKUP_DIR/kubeconfigs/k3s.yaml" /etc/rancher/k3s/k3s.yaml
      chown root:root /etc/rancher/k3s/k3s.yaml
      chmod 644 /etc/rancher/k3s/k3s.yaml
      echo "✅ k3s.yaml restored from backup"
    fi
    
    # Restore user kubeconfig from backup
    if [ -n "${SUDO_USER:-}" ] && [ -f "$BACKUP_DIR/kubeconfigs/config" ]; then
      USER_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
      mkdir -p "$USER_HOME/.kube"
      cp "$BACKUP_DIR/kubeconfigs/config" "$USER_HOME/.kube/config"
      chown -R "$SUDO_USER:$SUDO_USER" "$USER_HOME/.kube"
      echo "✅ User kubeconfig restored from backup"
    fi
    
    # Start k3s again
    echo "▶️  Starting k3s with restored certificates..."
    systemctl start k3s
    sleep 5
    
    echo ""
    echo "✅ Certificates and credentials restored!"
    echo "   Your existing kubeconfig files should continue to work"
  fi
  echo ""
fi

echo "Next steps:"
echo "  See docs/howto/setup-cluster.md for Pulumi setup and deployment"
echo ""
echo "Next steps:"
echo "  See docs/howto/setup-cluster.md for Pulumi setup and deployment"
