#!/bin/bash
set -e

# Restore Pulumi config from encrypted backup
# No Python dependency - pure bash implementation

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/pulumi-config.enc.yaml"
SOPS="$(which sops)"
TEMP_CONFIG=$(mktemp)
TEMP_KEY=$(mktemp)
TEMP_ESC=$(mktemp)
trap "rm -f $TEMP_CONFIG $TEMP_KEY $TEMP_ESC $TEMP_ESC.yaml" EXIT

STACK_NAME="${1:-.}"

declare -A OVERRIDE_SECRETS
shift || true
while [[ $# -gt 0 ]]; do
  if [[ "$1" == *"="* ]]; then
    OVERRIDE_SECRETS["${1%%=*}"]="${1#*=}"
  fi
  shift
done

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Encrypted config not found at $CONFIG_FILE"
    exit 1
fi

if [ -n "$SOPS_AGE_KEY_FILE" ] && [ -f "$SOPS_AGE_KEY_FILE" ]; then
    export SOPS_AGE_KEY_FILE="$SOPS_AGE_KEY_FILE"
elif [ -n "$SOPS_AGE_KEY" ]; then
    echo "$SOPS_AGE_KEY" > "$TEMP_KEY"
    chmod 600 "$TEMP_KEY"
    export SOPS_AGE_KEY_FILE="$TEMP_KEY"
elif [ -f "$SCRIPT_DIR/.sops.age" ]; then
    export SOPS_AGE_KEY_FILE="$SCRIPT_DIR/.sops.age"
elif [ ! -t 0 ]; then
    cat > "$TEMP_KEY"
    chmod 600 "$TEMP_KEY"
    export SOPS_AGE_KEY_FILE="$TEMP_KEY"
else
    echo "Error: AGE key not found"
    exit 1
fi

echo "======================================"
echo "Pulumi Config Restore"
echo "======================================"
echo "Target stack: $STACK_NAME"
echo ""

echo "Decrypting configuration..."
"$SOPS" -d "$CONFIG_FILE" > "$TEMP_CONFIG"

echo "Restoring configuration to Pulumi..."

sed -n '/^config:/,/^esc_environments:/p' "$TEMP_CONFIG" | grep -v "^config:" | grep -v "^esc_environments:" | \
while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]{6} ]] && continue
    
    if [[ "$line" =~ ^[[:space:]]{2}([a-zA-Z0-9:_-]+): ]]; then
        key="${BASH_REMATCH[1]}"
        
        is_secret=$(sed -n "/^  $key:/,/^  [a-z]/p" "$TEMP_CONFIG" | grep "secret:" | grep -c "true" || echo 0)
        value=$(sed -n "/^  $key:/,/^  [a-z]/p" "$TEMP_CONFIG" | grep "value:" | sed "s/.*value:[[:space:]]*//; s/['\"]//g" | head -1)
        
        if [ -v "OVERRIDE_SECRETS[$key]" ]; then
            value="${OVERRIDE_SECRETS[$key]}"
        fi
        
        if [ "$is_secret" == "1" ] && [ -z "$value" ]; then
            echo "[WARN] Skipping secret: $key"
            continue
        fi
        
        [ -z "$value" ] && continue
        
        if [ "$is_secret" == "1" ]; then
            pulumi config set --secret "$key" "$value" --stack "$STACK_NAME" 2>/dev/null && echo "[OK]   $key" || echo "[FAIL] $key"
        else
            pulumi config set "$key" "$value" --stack "$STACK_NAME" 2>/dev/null && echo "[OK]   $key" || echo "[FAIL] $key"
        fi
    fi
done

echo ""
echo "--- Restoring ESC Environments ---"

if grep -q "^esc_environments:" "$TEMP_CONFIG"; then
    sed -n '/^esc_environments:/,$p' "$TEMP_CONFIG" | grep "^    [a-zA-Z0-9_-]*:" | while IFS= read -r env_line; do
        env_key=$(echo "$env_line" | sed 's/^[[:space:]]*//; s/:.*//')
        
        env_name=$(sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | \
                   grep "name:" | head -1 | sed "s/.*name:[[:space:]]*//; s/['\"]//g")
        
        if [ -z "$env_name" ]; then
            continue
        fi
        
        {
            echo "values:"
            sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | \
                sed -n '/^        values:/,/^        [a-z]/p' | \
                tail -n +2 | tail -1 | \
                sed 's/^        /  /'
        } > "$TEMP_ESC.yaml"
        
        if grep -q "[a-zA-Z]" "$TEMP_ESC.yaml"; then
            pulumi env edit "$env_name" --file "$TEMP_ESC.yaml" 2>/dev/null && \
                echo "[OK]   ESC: $env_name" || echo "[FAIL] ESC: $env_name"
        fi
        
        rm -f "$TEMP_ESC.yaml"
    done
fi

echo ""
echo "======================================"
echo "Restore Complete!"
echo "======================================"
