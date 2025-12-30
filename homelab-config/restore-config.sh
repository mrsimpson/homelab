#!/bin/bash
set -e

# Restore Pulumi config from encrypted backup
# This decrypts the SOPS-encrypted config and restores it to a Pulumi stack
# Usage: ./restore-config.sh [stack-name] [secret-key=value ...]
#
# Examples:
#   cat ~/.sops-backup/key.age | ./restore-config.sh production
#   SOPS_AGE_KEY=$(cat ~/.sops-backup/key.age) ./restore-config.sh production
#   SOPS_AGE_KEY_FILE=~/.sops-backup/key.age ./restore-config.sh production
#   ./restore-config.sh production cloudflare:apiToken=abc123

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/pulumi-config.enc.yaml"
SOPS="${HOME}/go/bin/sops"
TEMP_CONFIG=$(mktemp)
TEMP_KEY=$(mktemp)
trap "rm -f $TEMP_CONFIG $TEMP_KEY" EXIT

STACK_NAME="${1:-.}"

# Collect secrets passed as arguments (key=value format)
declare -A OVERRIDE_SECRETS
shift || true
while [[ $# -gt 0 ]]; do
  if [[ "$1" == *"="* ]]; then
    KEY="${1%%=*}"
    VALUE="${1#*=}"
    OVERRIDE_SECRETS["$KEY"]="$VALUE"
  fi
  shift
done

# Check prerequisites
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Encrypted config not found at $CONFIG_FILE"
    echo "Please run export-config.sh first"
    exit 1
fi

# Handle AGE key from multiple sources (in priority order)
if [ -n "$SOPS_AGE_KEY_FILE" ] && [ -f "$SOPS_AGE_KEY_FILE" ]; then
    # Key file path provided via environment variable
    export SOPS_AGE_KEY_FILE="$SOPS_AGE_KEY_FILE"
elif [ -n "$SOPS_AGE_KEY" ]; then
    # Key provided directly via environment variable
    echo "$SOPS_AGE_KEY" > "$TEMP_KEY"
    chmod 600 "$TEMP_KEY"
    export SOPS_AGE_KEY_FILE="$TEMP_KEY"
elif [ -f "$SCRIPT_DIR/.sops.age" ]; then
    # Fall back to local key file in script directory
    export SOPS_AGE_KEY_FILE="$SCRIPT_DIR/.sops.age"
else
    # Try to read from stdin if available
    if [ ! -t 0 ]; then
        cat > "$TEMP_KEY"
        chmod 600 "$TEMP_KEY"
        export SOPS_AGE_KEY_FILE="$TEMP_KEY"
    else
        echo "Error: AGE key not found. Provide one of:"
        echo "  1. Pipe the key: cat ~/.sops-backup/key.age | ./restore-config.sh production"
        echo "  2. Environment variable: SOPS_AGE_KEY=\$(cat key.age) ./restore-config.sh production"
        echo "  3. Key file path: SOPS_AGE_KEY_FILE=~/.sops-backup/key.age ./restore-config.sh production"
        echo "  4. Local file: Place .sops.age in the script directory"
        exit 1
    fi
fi

echo "======================================"
echo "Pulumi Config Restore"
echo "======================================"
echo ""
echo "Target stack: $STACK_NAME"
echo ""

# Decrypt config
echo "Decrypting configuration..."
"$SOPS" -d "$CONFIG_FILE" > "$TEMP_CONFIG"

# Parse YAML and restore to Pulumi
echo "Restoring configuration to Pulumi..."
echo "Note: ESC environments require 'pulumi env edit' permissions"
OVERRIDE_SECRETS_JSON=$(for key in "${!OVERRIDE_SECRETS[@]}"; do echo "\"$key\": \"${OVERRIDE_SECRETS[$key]}\""; done | paste -sd, -)
if [ -z "$OVERRIDE_SECRETS_JSON" ]; then
  OVERRIDE_SECRETS_JSON="{}"
else
  OVERRIDE_SECRETS_JSON="{$OVERRIDE_SECRETS_JSON}"
fi

OVERRIDE_SECRETS_JSON="$OVERRIDE_SECRETS_JSON" python3 << PYTHON
import yaml
import subprocess
import sys
import json
import os

with open('$TEMP_CONFIG', 'r') as f:
    config_data = yaml.safe_load(f)

if not config_data or 'config' not in config_data:
    print("Error: No config found in decrypted file")
    sys.exit(1)

stack = '$STACK_NAME'
failed_keys = []

# Load override secrets from environment
override_secrets = json.loads(os.environ.get('OVERRIDE_SECRETS_JSON', '{}'))

for key, val in config_data['config'].items():
    value = val.get('value', '')
    is_secret = val.get('secret', False)
    
    # Use override secret if provided
    if key in override_secrets:
        value = override_secrets[key]
    
    # Skip empty values for secrets (user must set them manually)
    if is_secret and not value:
        print(f"⚠️  Skipping secret (empty): {key}")
        print(f"   Please set manually: pulumi config set --secret {key} <value> --stack {stack}")
        continue
    
    try:
        cmd = ['pulumi', 'config', 'set']
        if is_secret:
            cmd.append('--secret')
        cmd.extend([key, str(value), '--stack', stack])
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"✓ {key}")
    except subprocess.CalledProcessError as e:
        print(f"✗ {key}: {e.stderr.decode()}")
        failed_keys.append(key)

# Restore ESC environments
esc_failed_envs = []
if 'esc_environments' in config_data:
    print("\n--- Restoring ESC Environments ---")
    for env_key, env_config in config_data['esc_environments'].items():
        env_name = env_config.get('name', env_key)
        env_values = env_config.get('values', {})
        
        if not env_values:
            print(f"⚠️  Skipping ESC environment (empty): {env_name}")
            continue
        
        try:
            # Create a temporary YAML file for the environment definition
            import tempfile
            with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_env_file:
                yaml.dump({'values': env_values}, temp_env_file, default_flow_style=False)
                temp_env_path = temp_env_file.name
            
            # Import the environment using pulumi env edit
            cmd = ['pulumi', 'env', 'edit', env_name, '--file', temp_env_path]
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            
            # Clean up temp file
            os.unlink(temp_env_path)
            
            print(f"✓ ESC environment: {env_name}")
            
        except subprocess.CalledProcessError as e:
            print(f"✗ ESC environment {env_name}: {e.stderr.decode().strip()}")
            esc_failed_envs.append(env_name)
            # Clean up temp file on error
            try:
                os.unlink(temp_env_path)
            except:
                pass
        except Exception as e:
            print(f"✗ ESC environment {env_name}: {str(e)}")
            esc_failed_envs.append(env_name)

total_failures = len(failed_keys) + len(esc_failed_envs)
if total_failures > 0:
    print(f"\nWarning: {len(failed_keys)} configuration(s) and {len(esc_failed_envs)} ESC environment(s) failed to restore")
    if esc_failed_envs:
        print("ESC environment failures may be due to missing permissions.")
        print("You may need to manually restore ESC environments using:")
        for env_name in esc_failed_envs:
            print(f"  pulumi env edit {env_name}")
    sys.exit(1)
else:
    print(f"\n✓ All configurations and ESC environments restored successfully")

PYTHON

echo ""
echo "======================================"
echo "Restore Complete!"
echo "======================================"
echo ""
echo "Verify: pulumi config --stack $STACK_NAME"
echo ""
