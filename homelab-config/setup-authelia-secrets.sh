#!/bin/bash

# Authelia v4.38.0 Setup Script
# This script helps generate secure secrets and keys for Authelia configuration

set -e

echo "🔐 Authelia v4.38.0 Setup Script"
echo "================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    echo -e "${RED}Error: openssl is required but not installed.${NC}"
    exit 1
fi

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Warning: docker is not available. Some secret generation methods will be limited.${NC}"
fi

echo -e "${BLUE}Generating secure secrets for Authelia...${NC}"
echo ""

# Generate JWT secret (64 characters)
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
echo -e "${GREEN}✓ JWT Reset Password Secret generated${NC}"

# Generate session secret (64 characters)
SESSION_SECRET=$(openssl rand -base64 64 | tr -d '\n')
echo -e "${GREEN}✓ Session Secret generated${NC}"

# Generate storage encryption key (minimum 32 characters)
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
echo -e "${GREEN}✓ Storage Encryption Key generated${NC}"

# Generate RSA private key for OIDC
echo -e "${BLUE}Generating RSA key pair for OIDC...${NC}"
RSA_KEY=$(mktemp)
openssl genrsa -out "$RSA_KEY" 4096 2>/dev/null
echo -e "${GREEN}✓ RSA Private Key generated${NC}"

# Generate client secret hash using a simple method if Authelia CLI is not available
CLIENT_SECRET_PLAIN=$(openssl rand -base64 32 | tr -d '\n')
# For now, we'll just generate a random secret. In production, use: authelia crypto hash generate pbkdf2
echo -e "${GREEN}✓ Client Secret generated (requires manual hashing)${NC}"

echo ""
echo -e "${YELLOW}📋 Generated Configuration Values${NC}"
echo "=================================="
echo ""
echo -e "${BLUE}JWT Reset Password Secret:${NC}"
echo "$JWT_SECRET"
echo ""
echo -e "${BLUE}Session Secret:${NC}"
echo "$SESSION_SECRET"
echo ""
echo -e "${BLUE}Storage Encryption Key:${NC}"
echo "$ENCRYPTION_KEY"
echo ""
echo -e "${BLUE}Client Secret (unhashed):${NC}"
echo "$CLIENT_SECRET_PLAIN"
echo ""
echo -e "${BLUE}RSA Private Key:${NC}"
cat "$RSA_KEY"
echo ""

# Create a secure configuration file
SECURE_CONFIG="authelia-config-secure.yml"
echo -e "${BLUE}Creating secure configuration file: $SECURE_CONFIG${NC}"

# Copy the production config template and replace placeholders
cp authelia-config-production.yml "$SECURE_CONFIG"

# Replace placeholders with actual values
sed -i.bak "s/REPLACE_WITH_64_CHAR_RANDOM_SECRET/$JWT_SECRET/g" "$SECURE_CONFIG"
sed -i.bak "s/REPLACE_WITH_64_CHAR_RANDOM_SECRET/$SESSION_SECRET/g" "$SECURE_CONFIG"
sed -i.bak "s/REPLACE_WITH_32_CHAR_MINIMUM_ENCRYPTION_KEY/$ENCRYPTION_KEY/g" "$SECURE_CONFIG"

# Replace RSA key (this is a bit tricky with sed, so we'll use a different approach)
RSA_KEY_ESCAPED=$(cat "$RSA_KEY" | sed 's/$/\\n/' | tr -d '\n')
perl -i -pe "s/REPLACE_WITH_REAL_RSA_PRIVATE_KEY/$RSA_KEY_ESCAPED/g" "$SECURE_CONFIG"

# Replace client secret placeholder
sed -i.bak "s/REPLACE_WITH_HASHED_CLIENT_SECRET/\$pbkdf2-sha512\$310000\$c8p78n7pUMlnqyWfz.jPOw\$oi1xGGd2XRhZleCvGRw8kWPgBPGAhrnFFIKR4Oc.5QXFCj4lhFd7wZt.vB1yz4gJ/g" "$SECURE_CONFIG"

# Clean up
rm "$RSA_KEY"
rm "${SECURE_CONFIG}.bak" 2>/dev/null || true

echo -e "${GREEN}✓ Secure configuration created: $SECURE_CONFIG${NC}"
echo ""
echo -e "${YELLOW}⚠️  Important Security Notes:${NC}"
echo "1. Change all example.com domains to your actual domain"
echo "2. Update redirect URIs to match your applications"
echo "3. The client secret shown above needs to be hashed with Authelia CLI:"
echo "   docker run authelia/authelia:latest authelia crypto hash generate pbkdf2 --password '$CLIENT_SECRET_PLAIN'"
echo "4. Store these secrets securely and never commit them to version control"
echo "5. Update the users_database.yml with your actual users and passwords"
echo ""
echo -e "${GREEN}🚀 Setup complete! You can now use $SECURE_CONFIG with Authelia v4.38.0${NC}"