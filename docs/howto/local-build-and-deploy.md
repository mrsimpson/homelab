# How to: Build and Deploy Apps Locally (Without GitHub Actions)

This guide shows you how to build and deploy custom applications using local scripts instead of GitHub Actions. This is useful for:

- 🚀 Rapid development iteration
- 🔒 Private/internal apps you don't want on GitHub
- 🏠 Fully local homelab workflow
- 📚 Learning Docker and container workflows

## Prerequisites

- ✅ Docker installed locally
- ✅ GHCR credentials configured (see [setup-ghcr-credentials.md](./setup-ghcr-credentials.md))
- ✅ Homelab infrastructure deployed
- ✅ (Optional) Trivy installed for vulnerability scanning
- ✅ (Optional) GitHub CLI (`gh`) for easy authentication

---

## Quick Start

```bash
# 1. Authenticate to GHCR (one-time)
gh auth login
# OR
docker login ghcr.io

# 2. Build and push
PUSH=true ./build.sh

# 3. Deploy
cd deployment
pulumi up
```

---

## Authentication Options

### Option 1: GitHub CLI (Recommended) 🎯

```bash
# Install GitHub CLI
# macOS:
brew install gh

# Linux:
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh

# Authenticate (one-time setup)
gh auth login

# The build.sh script will automatically use gh auth token
```

**Advantages:**
- ✅ Automatic token refresh
- ✅ No manual token management
- ✅ Supports multi-factor authentication
- ✅ Integrates with GitHub APIs

### Option 2: Environment Variables

```bash
# Create a PAT at https://github.com/settings/tokens
# Required scope: write:packages

# Set environment variables
export GITHUB_USERNAME="your-github-username"
export GITHUB_TOKEN="ghp_YourTokenHere"

# Run build script
PUSH=true ./build.sh
```

**Store in `.envrc` (if using direnv):**
```bash
# .envrc
export GITHUB_USERNAME="your-github-username"
export GITHUB_TOKEN="ghp_YourTokenHere"
```

Then:
```bash
direnv allow
PUSH=true ./build.sh
```

### Option 3: Docker Login (Manual)

```bash
# Interactive login
docker login ghcr.io
# Username: your-github-username
# Password: ghp_YourTokenHere

# Non-interactive
echo "ghp_YourTokenHere" | docker login ghcr.io -u your-github-username --password-stdin
```

**Note:** Docker stores credentials in `~/.docker/config.json`

---

## PAT Requirements

Your Personal Access Token needs these scopes:

| Action | Required Scope |
|--------|----------------|
| Pull images (Kubernetes) | `read:packages` |
| Push images (local build) | `write:packages` ✅ |
| Delete old images | `delete:packages` (optional) |

### Create PAT with Correct Scopes

1. Visit https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: `homelab-local-dev`
4. Expiration: 90 days
5. Select scopes:
   - ✅ `write:packages` (includes read:packages)
   - ✅ `delete:packages` (optional - for cleanup)
6. Generate and copy token

---

## Using the Build Script

### Basic Usage

```bash
# Build only (local testing)
./build.sh

# Build and push to GHCR
PUSH=true ./build.sh

# Build with custom version
VERSION=v1.2.3 PUSH=true ./build.sh

# Skip tests (faster iteration)
SKIP_TEST=true PUSH=true ./build.sh

# Fail on critical vulnerabilities
FAIL_ON_VULN=true ./build.sh
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REGISTRY` | `ghcr.io/your-username` | Container registry URL |
| `VERSION` | `latest` | Image tag |
| `PUSH` | `false` | Push to registry after build |
| `SKIP_TEST` | `false` | Skip container health check |
| `FAIL_ON_VULN` | `false` | Fail build on critical vulnerabilities |
| `PLATFORMS` | `linux/amd64` | Target platforms |
| `GITHUB_USERNAME` | - | GitHub username for auth |
| `GITHUB_TOKEN` | - | GitHub PAT for auth |

### Examples

**Development iteration (no push):**
```bash
# Quick build and test
./build.sh

# Test the image
docker run -p 3000:3000 ghcr.io/your-username/my-custom-app:latest
curl http://localhost:3000
```

**Production release:**
```bash
# Tag code
git tag v1.0.0

# Build and push with version tag
VERSION=v1.0.0 PUSH=true FAIL_ON_VULN=true ./build.sh

# Deploy
cd deployment
IMAGE_VERSION=v1.0.0 pulumi up
```

**Multi-architecture build:**
```bash
# Build for both amd64 and arm64 (e.g., Raspberry Pi)
PLATFORMS=linux/amd64,linux/arm64 PUSH=true ./build.sh
```

---

## Complete Local Development Workflow

### Directory Structure

```
my-custom-app/
├── app/                    # Application source code
│   ├── index.js
│   └── package.json
├── deployment/             # Pulumi deployment
│   ├── index.ts
│   ├── Pulumi.yaml
│   └── package.json
├── Dockerfile
├── build.sh               # Local build script
├── deploy.sh              # Combined build + deploy script
├── .dockerignore
├── .envrc                 # Environment variables (gitignored)
└── README.md
```

### Step-by-Step Workflow

**1. Initial Setup (one-time):**
```bash
# Create PAT and authenticate
gh auth login
# OR
docker login ghcr.io

# Install Trivy (optional but recommended)
brew install trivy  # macOS
# OR
sudo apt install trivy  # Linux

# Configure Pulumi
cd deployment
npm install
pulumi login
pulumi stack init dev
```

**2. Development Cycle:**
```bash
# Edit application code
vim app/index.js

# Test locally (without Docker)
cd app
npm install
npm start
# Test at http://localhost:3000

# Build Docker image
cd ..
./build.sh

# Test containerized version
docker run -p 3000:3000 ghcr.io/your-username/my-app:latest
curl http://localhost:3000/health

# If looks good, push to GHCR
PUSH=true ./build.sh

# Deploy to homelab
cd deployment
pulumi up
```

**3. Quick Deploy Script:**

Create `deploy.sh` for one-command deployment:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Building and deploying my-custom-app..."

# Step 1: Build and push image
echo ""
echo "Step 1: Building Docker image..."
PUSH=true ./build.sh

# Step 2: Deploy with Pulumi
echo ""
echo "Step 2: Deploying to Kubernetes..."
cd deployment
pulumi up --yes

echo ""
echo "✅ Deployment complete!"
echo "Visit: https://myapp.yourdomain.com"
```

Make it executable:
```bash
chmod +x deploy.sh
```

Usage:
```bash
./deploy.sh
```

---

## Troubleshooting

### Authentication Issues

**Error: `unauthorized: authentication required`**

```bash
# Check if logged in
docker info 2>&1 | grep ghcr.io

# If not, login again
docker login ghcr.io

# Or use GitHub CLI
gh auth refresh
echo $(gh auth token) | docker login ghcr.io -u $(gh api user -q .login) --password-stdin
```

**Error: `insufficient_scope: authorization failed`**

Your PAT doesn't have `write:packages` scope:
1. Go to https://github.com/settings/tokens
2. Click on your token
3. Check "write:packages"
4. Regenerate token
5. Update and re-login

### Build Issues

**Error: `docker: command not found`**

Install Docker:
```bash
# macOS
brew install --cask docker

# Linux (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Logout and login again
```

**Error: `Cannot connect to the Docker daemon`**

```bash
# Start Docker daemon
# macOS: Start Docker Desktop app

# Linux:
sudo systemctl start docker
sudo systemctl enable docker
```

**Error: `no space left on device`**

Clean up old images:
```bash
# Remove unused images
docker image prune -a

# Remove all stopped containers
docker container prune

# See disk usage
docker system df
```

### Trivy Issues

**Trivy not found:**

```bash
# macOS
brew install trivy

# Linux (Ubuntu/Debian)
sudo apt install wget apt-transport-https gnupg lsb-release
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | sudo tee /usr/share/keyrings/trivy.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee -a /etc/apt/sources.list.d/trivy.list
sudo apt update
sudo apt install trivy
```

**Trivy database update errors:**

```bash
# Clear Trivy cache
trivy clean --all

# Update database manually
trivy image --download-db-only
```

---

## Comparison: Local Script vs GitHub Actions

| Feature | Local Script | GitHub Actions |
|---------|--------------|----------------|
| **Setup time** | 5 minutes | 10 minutes |
| **Build speed** | Fast (local CPU) | Medium (cloud runners) |
| **Iteration speed** | Very fast | Slow (git push required) |
| **Cost** | Free | Free (with limits) |
| **Automation** | Manual | Automatic on push |
| **Security scanning** | Optional (Trivy) | Built-in (Trivy + GitHub Security) |
| **Build logs** | Local terminal | GitHub Actions tab |
| **Audit trail** | None | Full git history |
| **Multi-platform** | Requires setup | Easy with matrix builds |
| **Best for** | Development | Production releases |

**Recommendation:** Use local script for development, GitHub Actions for production releases.

---

## Advanced Patterns

### Monorepo with Multiple Apps

```
homelab/
├── packages/
│   └── apps/
│       ├── app1/
│       │   ├── app/
│       │   ├── Dockerfile
│       │   └── build.sh
│       ├── app2/
│       │   ├── app/
│       │   ├── Dockerfile
│       │   └── build.sh
│       └── build-all.sh
```

**`build-all.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

for app in app1 app2; do
  echo "Building ${app}..."
  cd "${app}"
  PUSH=true ./build.sh
  cd ..
done
```

### Caching for Faster Builds

Use Docker BuildKit for layer caching:

```bash
# Enable BuildKit
export DOCKER_BUILDKIT=1

# Build with cache
docker build \
  --cache-from ghcr.io/your-username/my-app:latest \
  --tag ghcr.io/your-username/my-app:latest \
  .
```

### Git Hooks for Automatic Builds

**`.git/hooks/pre-push`:**
```bash
#!/usr/bin/env bash
set -e

echo "Running pre-push build..."
./build.sh

echo "All checks passed! Pushing..."
```

Make executable:
```bash
chmod +x .git/hooks/pre-push
```

---

## Security Best Practices

### ✅ Do's

- ✅ Store PAT in environment variables or password manager
- ✅ Set PAT expiration (90 days recommended)
- ✅ Use minimal scopes (`write:packages` only)
- ✅ Run Trivy scans before pushing
- ✅ Use `.dockerignore` to exclude secrets
- ✅ Regularly rotate tokens
- ✅ Use `gh` CLI for automatic token refresh

### ❌ Don'ts

- ❌ Commit PAT to git
- ❌ Share PAT with others
- ❌ Use PAT with unnecessary scopes
- ❌ Skip vulnerability scanning
- ❌ Push images with CRITICAL vulnerabilities
- ❌ Use `latest` tag in production
- ❌ Store credentials in Dockerfile

---

## Next Steps

- [ ] Set up automatic token rotation
- [ ] Add pre-commit hooks for linting
- [ ] Configure image signing with Cosign
- [ ] Set up local image scanning in CI/CD
- [ ] Implement SBOM generation
- [ ] Add integration tests before deployment

## References

- [Build Script Template](../examples/build.sh)
- [Setup GHCR Credentials](./setup-ghcr-credentials.md)
- [Deploy Custom App (External Repo)](./deploy-custom-app-external-repo.md)
- [GitHub CLI Documentation](https://cli.github.com/manual/)
- [Docker BuildKit](https://docs.docker.com/build/buildkit/)
- [Trivy Documentation](https://aquasecurity.github.io/trivy/)
