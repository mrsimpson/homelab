#!/bin/bash

# Setup Authelia Secrets for Pulumi Config
# This script generates secure secrets for Authelia and stores them in Pulumi config

set -e

echo "🔐 Generating Authelia secrets..."

# Check if we're in the right directory
if [ ! -f "Pulumi.yaml" ]; then
    echo "❌ Error: Run this script from the homelab root directory (where Pulumi.yaml exists)"
    exit 1
fi

# Function to generate a secure random string
generate_secret() {
    local length=$1
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to generate RSA private key for OIDC JWT signing
generate_rsa_key() {
    openssl genrsa 2048 2>/dev/null
}

# Function to generate HMAC key for storage encryption
generate_hmac_key() {
    openssl rand -base64 64 | tr -d '\n'
}

# Generate all required secrets
echo "Generating JWT secret..."
JWT_SECRET=$(generate_secret 64)

echo "Generating session secret..."
SESSION_SECRET=$(generate_secret 64) 

echo "Generating storage encryption key..."
ENCRYPTION_KEY=$(generate_hmac_key)

echo "Generating OIDC RSA private key..."
OIDC_PRIVATE_KEY=$(generate_rsa_key)

echo "Generating OIDC client secrets..."
SUPABASE_CLIENT_SECRET=$(generate_secret 64)

# Create temporary file for RSA key to avoid command line issues
TEMP_KEY_FILE=$(mktemp)
echo "$OIDC_PRIVATE_KEY" > "$TEMP_KEY_FILE"

# Store secrets in Pulumi config
echo "📝 Storing secrets in Pulumi config..."

pulumi config set authelia:jwtSecret "$JWT_SECRET" --secret
pulumi config set authelia:sessionSecret "$SESSION_SECRET" --secret  
pulumi config set authelia:encryptionKey "$ENCRYPTION_KEY" --secret
pulumi config set authelia:oidcPrivateKey --secret < "$TEMP_KEY_FILE"
pulumi config set authelia:supabaseClientSecret "$SUPABASE_CLIENT_SECRET" --secret

# Clean up temporary file
rm "$TEMP_KEY_FILE"

echo "✅ Authelia secrets configured successfully!"
echo ""
echo "📋 Summary of what was stored:"
echo "  - authelia:jwtSecret (secret)"
echo "  - authelia:sessionSecret (secret)"
echo "  - authelia:encryptionKey (secret)"
echo "  - authelia:oidcPrivateKey (secret)"
echo "  - authelia:supabaseClientSecret (secret)"
echo ""
echo "ℹ️  Using existing homelab:domain config for Authelia domain"
echo ""
echo "🚀 You can now deploy Authelia with: pulumi up"