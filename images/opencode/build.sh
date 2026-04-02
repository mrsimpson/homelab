#!/usr/bin/env bash
# build.sh — Build and push a non-root opencode image to GHCR.
#
# Usage:
#   ./images/opencode/build.sh [--push] [--revision <n>] [--ghcr-user <user>] [--token <PAT>]
#
# The image tag is: ghcr.io/<user>/opencode:<upstream-version>-homelab.<revision>
# e.g.  ghcr.io/mrsimpson/opencode:1.2.27-homelab.1
#
# Options:
#   --push              Push the image after building (default: build only)
#   --revision <n>      Custom revision suffix (default: 1)
#   --ghcr-user <user>  GitHub username / org for GHCR (default: mrsimpson)
#   --token <PAT>       GitHub PAT with write:packages scope (bypasses keychain)
#                       Can also be set via GITHUB_PAT env var
#
# Examples:
#   ./images/opencode/build.sh                                   # build only
#   ./images/opencode/build.sh --push --token ghp_xxx            # build + push
#   ./images/opencode/build.sh --push --revision 2               # bump homelab revision
#   GITHUB_PAT=ghp_xxx ./images/opencode/build.sh --push        # via env var

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

UPSTREAM_IMAGE="ghcr.io/anomalyco/opencode"
GHCR_USER="mrsimpson"
IMAGE_NAME="opencode"

PUSH=false
REVISION=5
TOKEN="${GITHUB_PAT:-}"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)         PUSH=true;          shift ;;
    --revision)     REVISION="$2";      shift 2 ;;
    --ghcr-user)    GHCR_USER="$2";     shift 2 ;;
    --token)        TOKEN="$2";         shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve upstream version
# ---------------------------------------------------------------------------
echo "→ Fetching upstream opencode version from ${UPSTREAM_IMAGE} ..."

UPSTREAM_VERSION=$(docker run --rm --entrypoint opencode "${UPSTREAM_IMAGE}" --version 2>/dev/null | tr -d '[:space:]')

if [[ -z "${UPSTREAM_VERSION}" ]]; then
  echo "✗ Could not determine upstream version. Is Docker running?" >&2
  exit 1
fi

echo "  Upstream version : ${UPSTREAM_VERSION}"
echo "  Revision         : ${REVISION}"

TAG="${UPSTREAM_VERSION}-homelab.${REVISION}"
REGISTRY="ghcr.io/${GHCR_USER}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"

echo "  Final image tag  : ${FULL_IMAGE}"
echo ""

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "→ Building ${FULL_IMAGE} (linux/amd64) ..."
# Always target linux/amd64 — the homelab cluster (flinker) runs on x86_64.
# buildx with --load loads the image into the local Docker daemon for inspection;
# when pushing, we re-run with --push instead of --load.
docker buildx build \
  --platform linux/amd64 \
  --label "org.opencontainers.image.base.name=${UPSTREAM_IMAGE}" \
  --label "org.opencontainers.image.version=${TAG}" \
  --label "org.opencontainers.image.source=https://github.com/mrsimpson/homelab" \
  --label "org.opencontainers.image.description=opencode web UI running as non-root (UID 1000)" \
  --tag "${FULL_IMAGE}" \
  --tag "${LATEST_IMAGE}" \
  "${SCRIPT_DIR}"

echo "✓ Build complete: ${FULL_IMAGE}"
echo ""

# ---------------------------------------------------------------------------
# Push (optional)
# ---------------------------------------------------------------------------
if [[ "${PUSH}" == "true" ]]; then
  # If a token was provided, log in explicitly (bypasses keychain)
  if [[ -n "${TOKEN}" ]]; then
    echo "→ Logging in to ghcr.io as ${GHCR_USER} ..."
    echo "${TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  fi

  echo "→ Pushing ${FULL_IMAGE} ..."
  # Re-run buildx with --push to push the linux/amd64 manifest directly to the registry
  docker buildx build \
    --platform linux/amd64 \
    --label "org.opencontainers.image.base.name=${UPSTREAM_IMAGE}" \
    --label "org.opencontainers.image.version=${TAG}" \
    --label "org.opencontainers.image.source=https://github.com/mrsimpson/homelab" \
    --label "org.opencontainers.image.description=opencode web UI running as non-root (UID 1000)" \
    --tag "${FULL_IMAGE}" \
    --tag "${LATEST_IMAGE}" \
    --push \
    "${SCRIPT_DIR}"
  echo "✓ Pushed: ${FULL_IMAGE}"
  echo "✓ Pushed: ${LATEST_IMAGE}"
  echo ""
  echo "Update the Pulumi app image to:"
  echo "  image: \"${FULL_IMAGE}\""
else
  echo "ℹ  Skipping push (pass --push to push to ${REGISTRY})"
  echo ""
  echo "When ready, run:"
  echo "  ${SCRIPT_DIR}/build.sh --push --token \$GITHUB_PAT"
fi
