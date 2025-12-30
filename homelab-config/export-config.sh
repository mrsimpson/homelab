#!/bin/bash
set -e

# Export Pulumi config and encrypt with SOPS
# This exports the current Pulumi configuration and encrypts it
# Usage: ./export-config.sh [project-dir] [secret-key=value ...]
#
# Examples:
#   ./export-config.sh .
#   ./export-config.sh . cloudflare:apiToken=abc123 homelab:pulumiAccessToken=xyz789
#   PULUMI_CLOUDFLARE_APITOKEN=abc123 ./export-config.sh .

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-.}"
KEY_FILE="$SCRIPT_DIR/.sops.age"
SOPS_CONFIG_FILE="$SCRIPT_DIR/.sops.yaml"
CONFIG_FILE="$SCRIPT_DIR/pulumi-config.enc.yaml"
SOPS="${HOME}/go/bin/sops"
TEMP_CONFIG=$(mktemp)

# Collect secrets passed as arguments (key=value format)
declare -A SECRETS
shift || true
while [[ $# -gt 0 ]]; do
  if [[ "$1" == *"="* ]]; then
    KEY="${1%%=*}"
    VALUE="${1#*=}"
    SECRETS["$KEY"]="$VALUE"
  fi
  shift
done

# Check prerequisites
if [ ! -f "$KEY_FILE" ]; then
    echo "Error: AGE key not found at $KEY_FILE"
    echo "Please run setup-encryption.sh first"
    exit 1
fi

if [ ! -f "$SOPS_CONFIG_FILE" ]; then
    echo "Error: SOPS config not found at $SOPS_CONFIG_FILE"
    echo "Please run setup-encryption.sh first"
    exit 1
fi

echo "======================================"
echo "Pulumi Config Export & Encryption"
echo "======================================"
echo ""

# Get the current stack
CURRENT_STACK=$(cd "$PROJECT_DIR" && pulumi stack ls 2>/dev/null | grep "true" | awk '{print $1}' | head -1 || echo "unknown")
echo "Current stack: $CURRENT_STACK"

# Export Pulumi config as JSON
echo "Exporting Pulumi configuration..."
PULUMI_JSON=$(cd "$PROJECT_DIR" && pulumi config --json)

# Create unencrypted YAML from JSON
echo "Converting to YAML format..."
SECRETS_JSON=$(for key in "${!SECRETS[@]}"; do echo "\"$key\": \"${SECRETS[$key]}\""; done | paste -sd, -)
if [ -z "$SECRETS_JSON" ]; then
  SECRETS_JSON="{}"
else
  SECRETS_JSON="{$SECRETS_JSON}"
fi

PULUMI_JSON="$PULUMI_JSON" SECRETS_JSON="$SECRETS_JSON" python3 > "$TEMP_CONFIG" << 'PYTHON'
import json
import os
from datetime import datetime

pulumi_json = os.environ.get('PULUMI_JSON', '{}')
secrets_json = os.environ.get('SECRETS_JSON', '{}')

try:
    cli_secrets = json.loads(secrets_json)
except json.JSONDecodeError:
    cli_secrets = {}

print("# Pulumi Configuration Backup")
print(f"# Exported at: {datetime.utcnow().isoformat()}Z")
print("#")
print("# This file is encrypted with SOPS/AGE")
print("# To view/edit: sops pulumi-config.enc.yaml")
print("# To restore: ./restore-config.sh [stack-name]")
print("")
print("config:")

data = json.loads(pulumi_json)
for key, val in sorted(data.items()):
    if val.get('secret'):
        print(f"  {key}:")
        print(f"    secret: true")
        # Use CLI secret if provided, otherwise leave empty for manual entry
        if key in cli_secrets:
            print(f'    value: {json.dumps(cli_secrets[key])}')
        else:
            print(f'    value: ""  # TODO: Fill in secret value')
    else:
        print(f"  {key}:")
        print(f'    value: {json.dumps(val.get("value", ""))}')
PYTHON

# Encrypt with SOPS
echo ""
echo "Encrypting with SOPS/AGE..."
# Move to script directory so SOPS finds the .sops.yaml config
cp "$TEMP_CONFIG" "$CONFIG_FILE"
(cd "$SCRIPT_DIR" && SOPS_AGE_KEY_FILE="$KEY_FILE" "$SOPS" -e -i "$CONFIG_FILE")
rm "$TEMP_CONFIG"

echo "✓ Configuration exported and encrypted"
echo ""
echo "======================================"
echo "Export Complete!"
echo "======================================"
echo ""
echo "Encrypted config: $CONFIG_FILE"
echo ""
echo "To restore:"
echo "  SOPS_AGE_KEY_FILE=~/.sops-backup/pulumi-homelab.age ./restore-config.sh my-stack"
echo ""
echo "To edit secrets:"
echo "  SOPS_AGE_KEY_FILE=~/.sops-backup/pulumi-homelab.age sops $CONFIG_FILE"
echo ""
