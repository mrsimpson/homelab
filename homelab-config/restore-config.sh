#!/bin/bash
set -e

# Restore Pulumi config from encrypted backup
# Pure bash with simple YAML parsing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/pulumi-config.enc.yaml"
SOPS="$(which sops)"
TEMP_CONFIG=$(mktemp)
TEMP_KEY=$(mktemp)
trap "rm -f $TEMP_CONFIG $TEMP_KEY" EXIT

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

# Parse config with simple approach
sed -n '/^config:/,/^esc_environments:/p' "$TEMP_CONFIG" | \
grep -E "^    [a-zA-Z]|^        (secret|value):" | \
awk '
/^    [a-zA-Z]/ {
    if (key != "") {
        print key "|" secret "|" value
    }
    key = $1
    gsub(/:$/, "", key)
    secret = ""
    value = ""
    next
}
/secret:/ {
    secret = $2
}
/value:/ {
    value = substr($0, index($0, $2))
    gsub(/^['\''"]/, "", value)
    gsub(/['\''"]$/, "", value)
}
END {
    if (key != "") {
        print key "|" secret "|" value
    }
}
' | while IFS='|' read -r key secret_val value_val; do
    [ -z "$key" ] && continue
    
    if [ -v "OVERRIDE_SECRETS[$key]" ]; then
        value_val="${OVERRIDE_SECRETS[$key]}"
    fi
    
    [ -z "$value_val" ] && continue
    
    is_secret=0
    [ "$secret_val" == "true" ] && is_secret=1
    
    if [ "$is_secret" == "1" ] && [ -z "$value_val" ]; then
        echo "[WARN] Skipping secret (empty): $key"
        continue
    fi
    
    if [ "$is_secret" == "1" ]; then
        if pulumi config set --secret "$key" "$value_val" --stack "$STACK_NAME" 2>/dev/null; then
            echo "[OK]   $key"
        else
            echo "[FAIL] $key"
        fi
    else
        if pulumi config set "$key" "$value_val" --stack "$STACK_NAME" 2>/dev/null; then
            echo "[OK]   $key"
        else
            echo "[FAIL] $key"
        fi
    fi
done

# Handle ESC environments - much simpler approach
echo ""
echo "--- Restoring ESC Environments ---"

# Extract environment names
sed -n '/^esc_environments:/,$p' "$TEMP_CONFIG" | grep "^    [a-zA-Z0-9_]*:$" | while read -r env_line; do
    env_key=$(echo "$env_line" | sed 's/:$//')
    
    # Get environment name  
    env_name=$(sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | grep "name: " | sed 's/.*name: //; s/['\''"]//g' | head -1)
    
    [ -z "$env_name" ] && continue
    
    # Create ESC YAML file - extract everything under "values:" and reformat
    TEMP_ESC=$(mktemp)
    {
        echo "values:"
        # Find the values section and extract with proper indentation
        sed -n "/^    $env_key:/,/^    [a-zA-Z]/p" "$TEMP_CONFIG" | \
            sed -n '/^        values:/,/^        [a-z]/p' | \
            tail -n +2 | \
            sed 's/^        /  /'
    } > "$TEMP_ESC"
    
    # Restore if has content
    if [ -s "$TEMP_ESC" ] && grep -q "[a-zA-Z]" "$TEMP_ESC"; then
        if pulumi env edit "$env_name" --file "$TEMP_ESC" 2>/dev/null; then
            echo "[OK]   ESC: $env_name"
        else
            echo "[FAIL] ESC: $env_name"
        fi
    else
        echo "[WARN] ESC environment empty: $env_name"
    fi
    
    rm -f "$TEMP_ESC"
done

echo ""
echo "======================================"
echo "Restore Complete!"
echo "======================================"
echo ""
