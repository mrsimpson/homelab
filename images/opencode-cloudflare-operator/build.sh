#!/usr/bin/env bash
# build.sh — Build and push the opencode-cloudflare-operator image to GHCR.
#
# Usage:
#   ./images/opencode-cloudflare-operator/build.sh [--push] [--revision <n>] [--ghcr-user <user>] [--token <PAT>]

set -euo pipefail

GHCR_USER="mrsimpson"
IMAGE_NAME="opencode-cloudflare-operator"
PUSH=false
REVISION=1
TOKEN="${GITHUB_PAT:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)         PUSH=true;          shift ;;
    --revision)     REVISION="$2";      shift 2 ;;
    --ghcr-user)    GHCR_USER="$2";     shift 2 ;;
    --token)        TOKEN="$2";         shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PACKAGE_VERSION=$(node -p "require('${SCRIPT_DIR}/package.json').version" 2>/dev/null)
TAG="${PACKAGE_VERSION}-homelab.${REVISION}"
REGISTRY="ghcr.io/${GHCR_USER}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

echo "→ Building ${FULL_IMAGE} (linux/amd64) ..."
docker buildx build \
  --platform linux/amd64 \
  --file "${SCRIPT_DIR}/Dockerfile" \
  --tag "${FULL_IMAGE}" \
  --tag "${REGISTRY}/${IMAGE_NAME}:latest" \
  --load \
  "${SCRIPT_DIR}"
echo "✓ Build complete: ${FULL_IMAGE}"

if [[ "${PUSH}" == "true" ]]; then
  if [[ -n "${TOKEN}" ]]; then
    echo "${TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
  fi
  docker buildx build \
    --platform linux/amd64 \
    --file "${SCRIPT_DIR}/Dockerfile" \
    --tag "${FULL_IMAGE}" \
    --tag "${REGISTRY}/${IMAGE_NAME}:latest" \
    --push \
    "${SCRIPT_DIR}"
  echo "✓ Pushed: ${FULL_IMAGE}"
  echo ""
  echo "Update Pulumi config:"
  echo "  pulumi config set opencode:cfOperatorImage \"${FULL_IMAGE}\""
else
  echo "ℹ  Pass --push to push to ${REGISTRY}"
fi
