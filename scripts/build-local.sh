#!/usr/bin/env bash
set -euo pipefail

# Configuration
APP_NAME="my-custom-app"
REGISTRY="${REGISTRY:-ghcr.io/your-username}"
IMAGE_NAME="${REGISTRY}/${APP_NAME}"
VERSION="${VERSION:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Change to script directory
cd "$(dirname "$0")"

log_info "Building ${APP_NAME}..."

# ============================================================================
# Step 0: Authenticate to GHCR (if pushing)
# ============================================================================
if [[ "${PUSH:-false}" == "true" ]]; then
    log_step "Step 0/4: Authenticating to GHCR..."

    # Check if already logged in
    if docker info 2>&1 | grep -q "ghcr.io"; then
        log_info "✓ Already authenticated to ghcr.io"
    else
        log_warn "Not authenticated to ghcr.io"

        # Try different authentication methods
        if command -v gh &> /dev/null; then
            # Option 1: Use GitHub CLI
            log_info "Using GitHub CLI for authentication..."
            GH_TOKEN=$(gh auth token 2>/dev/null || true)
            GH_USER=$(gh api user -q .login 2>/dev/null || true)

            if [[ -n "${GH_TOKEN}" && -n "${GH_USER}" ]]; then
                echo "${GH_TOKEN}" | docker login ghcr.io -u "${GH_USER}" --password-stdin
                log_info "✓ Authenticated via GitHub CLI"
            fi
        elif [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_USERNAME:-}" ]]; then
            # Option 2: Use environment variables
            log_info "Using GITHUB_TOKEN and GITHUB_USERNAME from environment..."
            echo "${GITHUB_TOKEN}" | docker login ghcr.io -u "${GITHUB_USERNAME}" --password-stdin
            log_info "✓ Authenticated via environment variables"
        else
            # Option 3: Interactive login
            log_warn "No automatic authentication method available"
            echo ""
            echo "Please authenticate to GHCR:"
            echo "  1. Create a PAT at https://github.com/settings/tokens"
            echo "     Required scope: write:packages"
            echo "  2. Run: docker login ghcr.io"
            echo ""
            read -p "Press Enter after logging in, or Ctrl+C to cancel..."

            # Verify login worked
            if ! docker info 2>&1 | grep -q "ghcr.io"; then
                log_error "Authentication failed. Please run: docker login ghcr.io"
                exit 1
            fi
        fi
    fi
fi

# ============================================================================
# Step 1: Build the Docker image
# ============================================================================
log_step "Step 1/4: Building Docker image..."
docker build \
    --platform "${PLATFORMS}" \
    --tag "${IMAGE_NAME}:${VERSION}" \
    --tag "${IMAGE_NAME}:$(git rev-parse --short HEAD 2>/dev/null || echo 'dev')" \
    .

log_info "✓ Image built: ${IMAGE_NAME}:${VERSION}"

# ============================================================================
# Step 2: Run Trivy scan (if available)
# ============================================================================
if command -v trivy &> /dev/null; then
    log_step "Step 2/4: Scanning image with Trivy..."

    # Scan and save results
    trivy image \
        --severity HIGH,CRITICAL \
        --format table \
        "${IMAGE_NAME}:${VERSION}"

    # Check for critical vulnerabilities (non-blocking by default)
    if trivy image \
        --severity CRITICAL \
        --exit-code 1 \
        --ignore-unfixed \
        "${IMAGE_NAME}:${VERSION}" 2>/dev/null; then
        log_info "✓ No critical vulnerabilities found"
    else
        log_warn "⚠ Critical vulnerabilities detected! Review before deploying."
        if [[ "${FAIL_ON_VULN:-false}" == "true" ]]; then
            log_error "Build failed due to critical vulnerabilities"
            exit 1
        fi
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Build cancelled"
            exit 1
        fi
    fi
else
    log_warn "Step 2/4: Trivy not found, skipping vulnerability scan"
    log_warn "Install with: brew install trivy (macOS) or apt install trivy (Linux)"
fi

# ============================================================================
# Step 3: Test the image locally (optional)
# ============================================================================
log_step "Step 3/4: Testing image..."
if [[ "${SKIP_TEST:-false}" != "true" ]]; then
    log_info "Starting container for health check..."

    # Run container in background
    CONTAINER_ID=$(docker run -d --rm -p 3000:3000 "${IMAGE_NAME}:${VERSION}")

    # Wait for container to be ready
    sleep 3

    # Health check
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        log_info "✓ Health check passed"
    else
        log_error "✗ Health check failed"
        docker logs "${CONTAINER_ID}"
        docker stop "${CONTAINER_ID}"
        exit 1
    fi

    # Stop test container
    docker stop "${CONTAINER_ID}" > /dev/null
    log_info "✓ Container test completed"
else
    log_warn "Skipping tests (SKIP_TEST=true)"
fi

# ============================================================================
# Step 4: Push to registry (optional)
# ============================================================================
log_step "Step 4/4: Push to registry?"
if [[ "${PUSH:-false}" == "true" ]]; then
    log_info "Pushing to ${REGISTRY}..."

    # Push both tags
    docker push "${IMAGE_NAME}:${VERSION}"

    GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo 'dev')
    if [[ "${GIT_SHA}" != "dev" ]]; then
        docker push "${IMAGE_NAME}:${GIT_SHA}"
    fi

    log_info "✓ Pushed to ${IMAGE_NAME}:${VERSION}"
else
    log_warn "Skipping push (use PUSH=true to push)"
    echo ""
    echo "To push manually:"
    echo "  docker push ${IMAGE_NAME}:${VERSION}"
    echo ""
    echo "Or rebuild with push:"
    echo "  PUSH=true ./build.sh"
fi

echo ""
log_info "🎉 Build complete!"
echo ""
echo "Image: ${IMAGE_NAME}:${VERSION}"
if [[ -n "$(git rev-parse --short HEAD 2>/dev/null || echo '')" ]]; then
    echo "SHA:   ${IMAGE_NAME}:$(git rev-parse --short HEAD)"
fi
echo ""
echo "Next steps:"
echo "  1. Run locally:  docker run -p 3000:3000 ${IMAGE_NAME}:${VERSION}"
echo "  2. Deploy:       cd deployment && pulumi up"
echo "  3. Access:       https://${APP_NAME}.yourdomain.com"
