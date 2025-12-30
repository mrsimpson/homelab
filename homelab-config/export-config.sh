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
PULUMI_SECRETS_JSON=$(cd "$PROJECT_DIR" && pulumi config --json --show-secrets)

# Export ESC environments
echo "Exporting Pulumi ESC environments..."
ESC_ENVS_JSON="{}"
if command -v pulumi >/dev/null 2>&1; then
    # Get list of ESC environments accessible to this project/user
    ESC_ENV_LIST=$(cd "$PROJECT_DIR" && pulumi env ls 2>/dev/null || echo "")
    if [ -n "$ESC_ENV_LIST" ]; then
        echo "Found ESC environments: $ESC_ENV_LIST"
        # Export each environment
        export ESC_ENV_LIST
        ESC_ENVS_JSON=$(cd "$PROJECT_DIR" && python3 << 'ENV_PYTHON'
import subprocess
import json
import os

envs = {}
env_list = os.environ.get('ESC_ENV_LIST', '').strip()
if env_list:
    for env in env_list.split('\n'):
        env = env.strip()
        if env:
            try:
                # Get the full environment name (including org if needed)
                if '/' not in env:
                    # Environment name like 'dev' needs org prepended
                    full_env = f"mrsimpson/{env}"
                elif env.count('/') == 1:
                    # Environment name like 'homelab/dev' needs org prepended
                    full_env = f"mrsimpson/{env}"
                else:
                    # Already full name like 'mrsimpson/homelab/dev'
                    full_env = env
                
                result = subprocess.run(['pulumi', 'env', 'open', full_env], capture_output=True, text=True)
                if result.returncode == 0:
                    envs[full_env] = json.loads(result.stdout)
                    print(f"✓ Exported ESC environment: {full_env}", file=os.sys.stderr)
                else:
                    print(f"⚠ Failed to export ESC environment {full_env}: {result.stderr}", file=os.sys.stderr)
            except Exception as e:
                print(f"⚠ Error exporting ESC environment {env}: {str(e)}", file=os.sys.stderr)

print(json.dumps(envs))
ENV_PYTHON
)
    else
        echo "No ESC environments found"
    fi
else
    echo "Pulumi CLI not available, skipping ESC environments"
fi

# Create unencrypted YAML from JSON
echo "Converting to YAML format..."
SECRETS_JSON=$(for key in "${!SECRETS[@]}"; do echo "\"$key\": \"${SECRETS[$key]}\""; done | paste -sd, -)
if [ -z "$SECRETS_JSON" ]; then
  SECRETS_JSON="{}"
else
  SECRETS_JSON="{$SECRETS_JSON}"
fi

PULUMI_JSON="$PULUMI_JSON" PULUMI_SECRETS_JSON="$PULUMI_SECRETS_JSON" SECRETS_JSON="$SECRETS_JSON" ESC_ENVS_JSON="$ESC_ENVS_JSON" python3 > "$TEMP_CONFIG" << 'PYTHON'
import json
import os
from datetime import datetime, timezone

pulumi_json = os.environ.get('PULUMI_JSON', '{}')
pulumi_secrets_json = os.environ.get('PULUMI_SECRETS_JSON', '{}')
secrets_json = os.environ.get('SECRETS_JSON', '{}')
esc_envs_json = os.environ.get('ESC_ENVS_JSON', '{}')

try:
    cli_secrets = json.loads(secrets_json)
except json.JSONDecodeError:
    cli_secrets = {}

try:
    esc_envs = json.loads(esc_envs_json)
except json.JSONDecodeError:
    esc_envs = {}

try:
    pulumi_secrets_data = json.loads(pulumi_secrets_json)
except json.JSONDecodeError:
    pulumi_secrets_data = {}

print("# Pulumi Configuration Backup")
print(f"# Exported at: {datetime.now(timezone.utc).isoformat()}")
print("#")
print("# This file is encrypted with SOPS/AGE")
print("# To view/edit: sops pulumi-config.enc.yaml")
print("# To restore: ./restore-config.sh [stack-name]")
print("")

# Export stack configuration
print("config:")
data = json.loads(pulumi_json)
for key, val in sorted(data.items()):
    if val.get('secret'):
        print(f"  {key}:")
        print(f"    secret: true")
        # Use CLI secret if provided, otherwise use actual secret value from --show-secrets
        if key in cli_secrets:
            print(f'    value: {json.dumps(cli_secrets[key])}')
        elif key in pulumi_secrets_data and pulumi_secrets_data[key].get('value'):
            print(f'    value: {json.dumps(pulumi_secrets_data[key]["value"])}')
        else:
            print(f'    value: ""  # TODO: Fill in secret value')
    else:
        print(f"  {key}:")
        print(f'    value: {json.dumps(val.get("value", ""))}')

# Export ESC environments
if esc_envs:
    print("")
    print("esc_environments:")
    for env_name, env_data in sorted(esc_envs.items()):
        print(f"  {env_name.replace('/', '_').replace('-', '_')}:")
        print(f"    name: {json.dumps(env_name)}")
        print("    values:")
        for key, value in sorted(env_data.items()):
            # All ESC values are treated as secrets for safety
            print(f"      {key}: {json.dumps(value)}")
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
