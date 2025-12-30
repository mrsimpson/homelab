#!/bin/bash
set -e

# Setup script for SOPS/AGE encryption
# This generates the encryption key and SOPS configuration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/.sops.age"
SOPS_CONFIG_FILE="$SCRIPT_DIR/.sops.yaml"

echo "======================================"
echo "SOPS/AGE Encryption Setup"
echo "======================================"
echo ""

# Check for required tools and set paths
echo "Checking for required tools..."
SOPS="${HOME}/go/bin/sops"
AGE_KEYGEN="${HOME}/go/bin/age-keygen"

if [ ! -f "$SOPS" ]; then
    echo "Error: sops not found at $SOPS. Please install it:"
    echo "  go install github.com/getsops/sops/v3/cmd/sops@latest"
    exit 1
fi

if [ ! -f "$AGE_KEYGEN" ]; then
    echo "Error: age-keygen not found at $AGE_KEYGEN. Please install it:"
    echo "  go install filippo.io/age/cmd/age-keygen@latest"
    exit 1
fi

echo "✓ sops and age found"
echo ""

# Generate AGE key if it doesn't exist
echo "Step 3: Setting up encryption key..."
if [ ! -f "$KEY_FILE" ]; then
    echo "Generating new AGE key..."
    "$AGE_KEYGEN" -o "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "✓ AGE key generated"
    echo ""
    echo "⚠️  IMPORTANT: Keep this key safe!"
    echo "Location: $KEY_FILE"
    echo ""
else
    echo "✓ AGE key already exists"
fi

# Create SOPS config
echo "Step 4: Creating SOPS configuration..."
AGE_PUBLIC_KEY=$("$AGE_KEYGEN" -y "$KEY_FILE")

cat > "$SOPS_CONFIG_FILE" << EOF
creation_rules:
  - path_regex: pulumi-config\.enc\.yaml$
    age: $AGE_PUBLIC_KEY
EOF

echo "✓ SOPS configuration created"
echo ""

echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Private key location: $KEY_FILE"
echo "Public key: $AGE_PUBLIC_KEY"
echo ""
echo "IMPORTANT: Backup the private key!"
echo "  mkdir -p ~/.sops-backup"
echo "  cp $KEY_FILE ~/.sops-backup/pulumi-homelab.age"
echo ""
echo "Next steps:"
echo "1. Backup the private key (see above)"
echo "2. Export config: ./export-config.sh /path/to/pulumi/project"
echo "3. For restore, set: export SOPS_AGE_KEY_FILE=~/.sops-backup/pulumi-homelab.age"
echo "4. Then restore: ./restore-config.sh [stack-name]"
echo ""
