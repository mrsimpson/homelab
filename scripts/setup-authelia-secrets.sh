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

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to generate argon2 hash
generate_admin_password_hash() {
    local password="$1"
    
    if command -v python3 &> /dev/null; then
        # Use Python argon2-cffi - install if needed
        python3 -c "
import sys
try:
    import argon2
    ph = argon2.PasswordHasher()
    hash_result = ph.hash('$password')
    print(hash_result)
except ImportError:
    print('ERROR: argon2-cffi not installed. Run: pip install argon2-cffi', file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
"
    else
        echo "ERROR: Python3 not found" >&2
        return 1
    fi
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
echo -e "${YELLOW}⚠️  Important: Admin Password Setup Required${NC}"
echo ""
echo -e "${BLUE}Generate a hashed admin password with:${NC}"
echo ""

if command -v python3 &> /dev/null; then
    echo -e "${GREEN}✓ Method 1: Using Python3 (recommended)${NC}"
    echo "  # Install: pip install argon2-cffi" 
    echo "  # Generate: python3 -c \"import argon2; print(argon2.PasswordHasher().hash('your-password'))\""
    echo ""
fi

if command -v docker &> /dev/null; then
    echo -e "${BLUE}Method 2: Using Docker${NC}"
    echo "  docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password"
    echo ""
fi

echo -e "${BLUE}Then store the generated hash in Pulumi config:${NC}"
echo "  pulumi config set homelab:autheliaAdminPasswordHash '\$argon2id\$v=19\$m=65536...' --secret"
echo ""

# Offer to generate admin password hash interactively
echo -e "${BLUE}💡 Optional: Generate admin password hash now?${NC}"
read -p "Do you want to generate an admin password hash interactively? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Enter admin password (input will be hidden):${NC}"
    read -s admin_password
    echo
    
    if [ -n "$admin_password" ]; then
        echo -e "${BLUE}Generating argon2 hash...${NC}"
        
        if admin_hash=$(generate_admin_password_hash "$admin_password"); then
            echo -e "${GREEN}✓ Password hash generated successfully!${NC}"
            echo ""
            echo -e "${BLUE}Storing in Pulumi config...${NC}"
            
            if pulumi config set homelab:autheliaAdminPasswordHash "$admin_hash" --secret; then
                echo -e "${GREEN}✓ Admin password hash stored in Pulumi config${NC}"
                echo ""
                echo -e "${GREEN}🎉 Complete! Admin password is configured and ready.${NC}"
            else
                echo -e "${YELLOW}⚠ Failed to store in Pulumi config. Manual command:${NC}"
                echo "  pulumi config set homelab:autheliaAdminPasswordHash '$admin_hash' --secret"
            fi
        else
            echo -e "${YELLOW}⚠ Could not generate hash automatically. Install argon2-cffi and try again:${NC}"
            echo "  pip install argon2-cffi"
        fi
    else
        echo -e "${YELLOW}⚠ Empty password provided. Skipping automatic generation.${NC}"
    fi
fi

echo ""
echo "ℹ️  Using existing homelab:domain config for Authelia domain"
echo ""
echo "🚀 You can now deploy Authelia with: pulumi up"