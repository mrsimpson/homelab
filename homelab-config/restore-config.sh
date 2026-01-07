#!/bin/bash
set -e

# Restore Pulumi config from encrypted backup
# This decrypts the SOPS-encrypted config and restores it to a Pulumi stack
# No external dependencies except: bash, sops, pulumi, and standard Unix tools
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
TEMP_ESC=$(mktemp)
trap "rm -f $TEMP_CONFIG $TEMP_KEY $TEMP_ESC $TEMP_ESC.yaml" EXIT

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
    export SOPS_AGE_KEY_FILE="$SOPS_AGE_KEY_FILE"
elif [ -n "$SOPS_AGE_KEY" ]; then
    echo "$SOPS_AGE_KEY" > "$TEMP_KEY"
    chmod 600 "$TEMP_KEY"
    export SOPS_AGE_KEY_FILE="$TEMP_KEY"
elif [ -f "$SCRIPT_DIR/.sops.age" ]; then
    export SOPS_AGE_KEY_FILE="$SCRIPT_DIR/.sops.age"
else
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

# Helper function to clean quotes from value
clean_value() {
    local val="$1"
    # Remove leading/trailing single and double quotes
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    echo "$val"
}

# Parse and restore config entries
echo "Restoring configuration to Pulumi..."
echo "Note: ESC environments require 'pulumi env edit' permissions"

failed_keys=()
esc_failed_envs=()

# Extract config section (between "config:" and "esc_environments:" or end of file)
sed -n '/^config:/,/^esc_environments:/p' "$TEMP_CONFIG" | \
grep -v "^config:" | \
grep -v "^esc_environments:" | \
while IFS= read -r line; do
    # Skip empty lines and nested values lines
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]{6}(secret|value): ]] && continue
    
    # Match top-level config keys (2 spaces indent)
    if [[ "$line" =~ ^[[:space:]]{2}([a-zA-Z0-9:_-]+): ]]; then
        key="${BASH_REMATCH[1]}"
        
        # Read the next 2 lines to get secret and value
        secret_line=$(grep -A 1 "^  $key:" "$TEMP_CONFIG" | grep "secret:" | head -1)
        value_line=$(grep -A 2 "^  $key:" "$TEMP_CONFIG" | grep "value:" | head -1)
        
        is_secret=0
        if [[ "$secret_line" =~ true ]]; then
            is_secret=1
        fi
        
        # Extract value
        if [[ "$value_line" =~ value:[[:space:]]*(.*) ]]; then
            value="${BASH_REMATCH[1]}"
            value=$(clean_value "$value")
        else
            value=""
        fi
        
        # Check for override secrets
        if [ -v "OVERRIDE_SECRETS[$key]" ]; then
            value="${OVERRIDE_SECRETS[$key]}"
        fi
        
        # Skip empty values for secrets
        if [ "$is_secret" == "1" ] && [ -z "$value" ]; then
            echo "⚠️  Skipping secret (empty): $key"
            echo "   Please set manually: pulumi config set --secret $key <value> --stack $STACK_NAME"
            continue
        fi
        
        # Skip completely empty values
        [ -z "$value" ] && continue
        
        # Restore config
        if [ "$is_secret" == "1" ]; then
            if pulumi config set --secret "$key" "$value" --stack "$STACK_NAME" 2>/dev/null; then
                echo "✓ $key"
            else
                echo "✗ $key: Failed to set"
                failed_keys+=("$key")
            fi
        else
            if pulumi config set "$key" "$value" --stack "$STACK_NAME" 2>/dev/null; then
                echo "✓ $key"
            else
                echo "✗ $key: Failed to set"
                failed_keys+=("$key")
            fi
        fi
    fi
done

# Handle ESC environments
echo ""
echo "--- Restoring ESC Environments ---"

# Extract ESC environments and process each one
if grep -q "^esc_environments:" "$TEMP_CONFIG"; then
    # Extract everything under esc_environments
    sed -n '/^esc_environments:/,$p' "$TEMP_CONFIG" | tail -n +2 | while IFS= read -r line; do
        # Stop if we hit another top-level key (shouldn't happen at end of file)
        [[ "$line" =~ ^[a-z_]+: && ! "$line" =~ ^[[:space:]] ]] && break
        
        # Look for environment definitions (4 spaces indent)
        if [[ "$line" =~ ^[[:space:]]{4}([a-zA-Z0-9_-]+): ]]; then
            env_key="${BASH_REMATCH[1]}"
            
            # Get the environment name
            env_name=$(sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | \
                       grep "name:" | head -1 | grep -o "name: .*" | sed "s/name: //" | tr -d "'"" || \
                       echo "")
            
            # If no name found, try without quotes
            if [ -z "$env_name" ]; then
                env_name=$(sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | \
                           grep "name:" | head -1 | sed "s/.*name:[[:space:]]*//")
            fi
            
            if [ -z "$env_name" ]; then
                echo "⚠️  Skipping ESC environment (no name found): $env_key"
                continue
            fi
            
            # Extract values section for this environment
            {
                echo "values:"
                sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | \
                    sed -n '/values:/,/^[^ ]/p' | \
                    tail -n +2 | head -n -1 | \
                    sed 's/^      /  /'
            } > "$TEMP_ESC.yaml"
            
            # Check if we have any values
            if grep -q "[a-zA-Z]" "$TEMP_ESC.yaml"; then
                if pulumi env edit "$env_name" --file "$TEMP_ESC.yaml" 2>/dev/null; then
                    echo "✓ ESC environment: $env_name"
                else
                    echo "✗ ESC environment $env_name: Failed to restore"
                    esc_failed_envs+=("$env_name")
                fi
            else
                echo "⚠️  Skipping ESC environment (empty): $env_name"
            fi
            
            rm -f "$TEMP_ESC.yaml"
        fi
    done
fi

# Report results
echo ""
total_failures=$((${#failed_keys[@]} + ${#esc_failed_envs[@]}))
if [ $total_failures -gt 0 ]; then
    echo "Warning: ${#failed_keys[@]} configuration(s) and ${#esc_failed_envs[@]} ESC environment(s) failed to restore"
    if [ ${#esc_failed_envs[@]} -gt 0 ]; then
        echo "ESC environment failures may be due to missing permissions."
        echo "You may need to manually restore ESC environments using:"
        for env_name in "${esc_failed_envs[@]}"; do
            echo "  pulumi env edit $env_name"
        done
    fi
    exit 1
else
    echo "✓ All configurations and ESC environments restored successfully"
fi

echo ""
echo "======================================"
echo "Restore Complete!"
echo "======================================"
echo ""
echo "Verify: pulumi config --stack $STACK_NAME"
echo ""
