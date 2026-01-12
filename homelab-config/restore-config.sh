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
SOPS="$(which sops)"
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

OVERRIDE_SECRETS_JSON="$OVERRIDE_SECRETS_JSON" TEMP_CONFIG="$TEMP_CONFIG" STACK_NAME="$STACK_NAME" python3 << 'PYTHON'
import json
import subprocess
import sys
import os
import re

# Simple YAML parser for our specific format (avoiding PyYAML dependency)
def parse_simple_yaml(content):
    config_data = {'config': {}}
    lines = content.split('\n')
    i = 0
    in_config = False
    
    while i < len(lines):
        line = lines[i]
        
        # Start config section
        if line.strip() == 'config:':
            in_config = True
            i += 1
            continue
            
        # End config section
        if in_config and line and not line.startswith(' '):
            in_config = False
            
        # Parse config entries (4 spaces indentation)
        if in_config and re.match(r'^    .+:$', line):
            # Extract key name
            key = line.strip().rstrip(':')
            entry = {}
            i += 1
            
            # Parse the properties (8 spaces indentation)
            while i < len(lines):
                prop_line = lines[i]
                
                # Check if this is still part of this entry
                if not prop_line.startswith('        '):
                    break
                    
                if 'secret: true' in prop_line:
                    entry['secret'] = True
                elif 'value:' in prop_line:
                    value_part = prop_line[prop_line.find('value:') + 6:].strip()
                    
                    if value_part == '|-':
                        # Multi-line value
                        value_lines = []
                        i += 1
                        while i < len(lines) and lines[i].startswith('            '):
                            value_lines.append(lines[i][12:])  # Remove 12 spaces
                            i += 1
                        entry['value'] = '\n'.join(value_lines)
                        continue  # Don't increment i again
                    else:
                        # Single line value (possibly JSON quoted)
                        if value_part.startswith('"') and value_part.endswith('"'):
                            # JSON string - remove quotes and handle escapes
                            entry['value'] = json.loads(value_part)
                        else:
                            entry['value'] = value_part
                
                i += 1
            
            config_data['config'][key] = entry
            continue
            
        i += 1
    
    return config_data

# Read and parse the config file
temp_config = os.environ.get('TEMP_CONFIG')
with open(temp_config, 'r') as f:
    content = f.read()

config_data = parse_simple_yaml(content)

if not config_data or 'config' not in config_data:
    print("Error: No config found in decrypted file")
    sys.exit(1)

print(f"Found {len(config_data.get('config', {}))} config entries")

stack = os.environ.get('STACK_NAME')
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
        cmd.extend([key, '--stack', stack])
        
        # Handle multi-line values by using stdin
        if '\n' in str(value):
            # For multi-line values, use stdin redirection
            result = subprocess.run(cmd, input=str(value), text=True, check=True, capture_output=True)
        else:
            # For single-line values, use command argument (faster)
            cmd.append(str(value))
            result = subprocess.run(cmd, check=True, capture_output=True)
        print(f"✓ {key}")
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.decode() if e.stderr else str(e)
        print(f"✗ {key}: {error_msg.strip()}")
        failed_keys.append(key)

if failed_keys:
    print(f"\n⚠️  Failed to restore {len(failed_keys)} config key(s): {', '.join(failed_keys)}")
else:
    print(f"\n✅ Successfully restored {len(config_data['config'])} config key(s)")

PYTHON

echo ""
echo "✅ Configuration restore complete!"
echo "You can now run 'pulumi up' to deploy to stack '$STACK_NAME'"

echo ""
echo "======================================"
echo "Restore Complete!"
echo "======================================"
echo ""
echo "Verify: pulumi config --stack $STACK_NAME"
echo ""
