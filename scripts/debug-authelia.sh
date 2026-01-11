#!/bin/bash

# Authelia Authentication Flow Debug Script
# This script tests the complete authentication flow to identify infinite redirect issues

set -e

# Configuration
AUTH_DOMAIN="auth.no-panic.org"
PROTECTED_DOMAIN="auth-demo.no-panic.org"
USERNAME="admin"
PASSWORD="secure-homelab-password"
COOKIES_FILE="./authelia-cookies.txt"
VERBOSE=true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

cleanup() {
    log "Cleaning up..."
    rm -f "$COOKIES_FILE" response.html response.json 2>/dev/null || true
}

# Trap cleanup on script exit
trap cleanup EXIT

log "Starting Authelia Authentication Flow Debug"
log "Auth Domain: $AUTH_DOMAIN"
log "Protected Domain: $PROTECTED_DOMAIN"
log "Username: $USERNAME"
echo

# Clean up any existing files
cleanup

# Step 1: Test initial access to protected resource
log "Step 1: Testing initial access to protected resource"
echo "curl -v -I \"https://$PROTECTED_DOMAIN/test\" -c \"$COOKIES_FILE\""
RESPONSE=$(curl -v -I "https://$PROTECTED_DOMAIN/test" -c "$COOKIES_FILE" 2>&1)

if echo "$RESPONSE" | grep -q "HTTP/2 302"; then
    success "Protected resource returns 302 redirect as expected"
    REDIRECT_URL=$(echo "$RESPONSE" | grep -i "location:" | cut -d' ' -f2 | tr -d '\r')
    log "Redirect URL: $REDIRECT_URL"
    
    if echo "$REDIRECT_URL" | grep -q "https://$AUTH_DOMAIN"; then
        success "Redirect points to auth domain correctly"
        # Extract the rd parameter
        RD_PARAM=$(echo "$REDIRECT_URL" | sed -n 's/.*rd=\([^&]*\).*/\1/p' | python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))")
        log "Return URL (rd parameter): $RD_PARAM"
        
        if echo "$RD_PARAM" | grep -q "^https://"; then
            success "Return URL uses HTTPS scheme"
        else
            error "Return URL uses incorrect scheme: $RD_PARAM"
        fi
    else
        error "Redirect does not point to auth domain: $REDIRECT_URL"
    fi
else
    error "Protected resource did not return 302 redirect"
    echo "$RESPONSE"
fi

echo

# Step 2: Test auth portal accessibility
log "Step 2: Testing auth portal accessibility"
echo "curl -I \"https://$AUTH_DOMAIN/\""
AUTH_RESPONSE=$(curl -v -I "https://$AUTH_DOMAIN/" 2>&1)

if echo "$AUTH_RESPONSE" | grep -q "HTTP/2 200"; then
    success "Auth portal is accessible"
else
    error "Auth portal is not accessible"
    echo "$AUTH_RESPONSE"
fi

echo

# Step 3: Get login page and extract CSRF token
log "Step 3: Getting login page and extracting CSRF token"
echo "curl -s \"https://$AUTH_DOMAIN/\" -c \"$COOKIES_FILE\""
curl -s "https://$AUTH_DOMAIN/" -c "$COOKIES_FILE" > response.html

if [ -s response.html ]; then
    success "Login page downloaded"
    
    # Try to extract CSRF token (if it exists)
    CSRF_TOKEN=$(grep -o 'csrf[^"]*' response.html | head -1 | cut -d'"' -f1 2>/dev/null || echo "")
    if [ -n "$CSRF_TOKEN" ]; then
        log "CSRF Token found: $CSRF_TOKEN"
    else
        log "No CSRF token found (may not be required)"
    fi
    
    # Check for login form
    if grep -q "username" response.html && grep -q "password" response.html; then
        success "Login form found on page"
    else
        warning "Login form may not be present or uses different field names"
    fi
else
    error "Failed to download login page"
fi

echo

# Step 4: Attempt login
log "Step 4: Attempting login"
LOGIN_DATA='{"username":"'"$USERNAME"'","password":"'"$PASSWORD"'","keepMeLoggedIn":false}'
echo "curl -X POST \"https://$AUTH_DOMAIN/api/firstfactor\" -H \"Content-Type: application/json\" -d '$LOGIN_DATA' -c \"$COOKIES_FILE\" -b \"$COOKIES_FILE\""

LOGIN_RESPONSE=$(curl -v -X POST "https://$AUTH_DOMAIN/api/firstfactor" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$LOGIN_DATA" \
    -c "$COOKIES_FILE" \
    -b "$COOKIES_FILE" \
    -w "\nSTATUS_CODE:%{http_code}\n" 2>&1)

STATUS_CODE=$(echo "$LOGIN_RESPONSE" | grep "STATUS_CODE:" | cut -d':' -f2)

if [ "$STATUS_CODE" = "200" ]; then
    success "Login request returned 200"
    
    # Extract JSON response
    JSON_RESPONSE=$(echo "$LOGIN_RESPONSE" | grep -E '^\{.*\}$' | tail -1)
    if [ -n "$JSON_RESPONSE" ]; then
        log "Login response: $JSON_RESPONSE"
        echo "$JSON_RESPONSE" > response.json
        
        if echo "$JSON_RESPONSE" | grep -q '"status":"OK"'; then
            success "Login successful according to response"
        else
            error "Login failed according to response"
            cat response.json
        fi
    fi
else
    error "Login request failed with status code: $STATUS_CODE"
    echo "$LOGIN_RESPONSE"
fi

echo

# Step 5: Check cookies after login
log "Step 5: Checking cookies after login"
if [ -f "$COOKIES_FILE" ]; then
    log "Cookies file contents:"
    cat "$COOKIES_FILE"
    
    if grep -q "authelia_session" "$COOKIES_FILE"; then
        success "Authelia session cookie found"
        SESSION_COOKIE=$(grep "authelia_session" "$COOKIES_FILE" | awk '{print $7}')
        log "Session cookie value: ${SESSION_COOKIE:0:20}..."
        
        # Check cookie domain
        COOKIE_DOMAIN=$(grep "authelia_session" "$COOKIES_FILE" | awk '{print $1}')
        log "Cookie domain: $COOKIE_DOMAIN"
        
        if [ "$COOKIE_DOMAIN" = ".no-panic.org" ] || [ "$COOKIE_DOMAIN" = "no-panic.org" ]; then
            success "Cookie domain is correct"
        else
            warning "Cookie domain may be incorrect: $COOKIE_DOMAIN"
        fi
    else
        error "No authelia_session cookie found after login"
    fi
else
    error "No cookies file found"
fi

echo

# Step 6: Test access to protected resource with session
log "Step 6: Testing access to protected resource with session"
echo "curl -v -I \"https://$PROTECTED_DOMAIN/test\" -b \"$COOKIES_FILE\""
PROTECTED_RESPONSE=$(curl -v -I "https://$PROTECTED_DOMAIN/test" -b "$COOKIES_FILE" 2>&1)

log "Response from protected resource:"
echo "$PROTECTED_RESPONSE" | grep -E "(HTTP/|location:|set-cookie:)" || echo "$PROTECTED_RESPONSE"

if echo "$PROTECTED_RESPONSE" | grep -q "HTTP/2 200"; then
    success "SUCCESS: Protected resource accessible with session!"
elif echo "$PROTECTED_RESPONSE" | grep -q "HTTP/2 302"; then
    warning "Still getting 302 redirect - authentication not working"
    NEW_REDIRECT=$(echo "$PROTECTED_RESPONSE" | grep -i "location:" | cut -d' ' -f2 | tr -d '\r')
    log "Redirecting to: $NEW_REDIRECT"
    
    if echo "$NEW_REDIRECT" | grep -q "$AUTH_DOMAIN"; then
        error "INFINITE REDIRECT DETECTED: Still redirecting to auth after login"
    else
        log "Redirecting to different location: $NEW_REDIRECT"
    fi
else
    error "Unexpected response from protected resource"
    echo "$PROTECTED_RESPONSE"
fi

echo

# Step 7: Test the forward auth endpoint directly
log "Step 7: Testing forward auth endpoint directly (if accessible)"
echo "Testing Authelia verify endpoint with session..."

# This might not work from outside the cluster, but worth trying
VERIFY_RESPONSE=$(curl -v -I "http://authelia.authelia.svc.cluster.local:9091/api/verify" \
    -H "X-Original-URL: https://$PROTECTED_DOMAIN/test" \
    -H "X-Original-Method: GET" \
    -H "X-Forwarded-Proto: https" \
    -H "X-Forwarded-Host: $PROTECTED_DOMAIN" \
    -b "$COOKIES_FILE" 2>&1 || echo "Could not reach internal endpoint")

if echo "$VERIFY_RESPONSE" | grep -q "HTTP"; then
    log "Forward auth endpoint response:"
    echo "$VERIFY_RESPONSE" | grep -E "(HTTP/|Remote-|authorization:)" || echo "$VERIFY_RESPONSE"
else
    log "Could not test forward auth endpoint directly (expected - internal service)"
fi

echo

# Step 8: Check Kubernetes resources
log "Step 8: Checking Kubernetes resources"
echo

log "Authelia pod status:"
kubectl get pods -n authelia 2>/dev/null || echo "Could not access kubectl"

echo

log "Auth-demo ingress annotations:"
kubectl get ingress auth-demo -n auth-demo -o jsonpath='{.metadata.annotations}' 2>/dev/null | jq . 2>/dev/null || echo "Could not access kubectl or parse annotations"

echo

# Summary
log "=== DEBUG SUMMARY ==="
if [ -f response.json ]; then
    if grep -q '"status":"OK"' response.json 2>/dev/null; then
        success "✅ Login: WORKING"
    else
        error "❌ Login: FAILED"
    fi
else
    warning "⚠️  Login: UNKNOWN"
fi

if [ -f "$COOKIES_FILE" ] && grep -q "authelia_session" "$COOKIES_FILE"; then
    success "✅ Session Cookie: SET"
else
    error "❌ Session Cookie: MISSING"
fi

if echo "$PROTECTED_RESPONSE" | grep -q "HTTP/2 200"; then
    success "✅ Protected Resource: ACCESSIBLE"
elif echo "$PROTECTED_RESPONSE" | grep -q "HTTP/2 302"; then
    if echo "$PROTECTED_RESPONSE" | grep -q "$AUTH_DOMAIN"; then
        error "❌ Protected Resource: INFINITE REDIRECT"
    else
        warning "⚠️  Protected Resource: REDIRECTING"
    fi
else
    error "❌ Protected Resource: ERROR"
fi

log "Debug completed. Check logs above for detailed analysis."