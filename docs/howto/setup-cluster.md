# How to Set Up the Cluster

## Goal

Bootstrap a k3s cluster and deploy core infrastructure with Pulumi.

## Prerequisites

- **Hardware:** Linux machine (4GB+ RAM, 2+ CPU cores, 20GB+ disk)
- **Domain:** Domain name managed by Cloudflare (free tier works)
- **Accounts:**
  - Cloudflare account with API token
  - GitHub/Google OAuth app (optional, for protected services)

## Step 1: Install k3s

SSH into your Linux machine and install k3s:

```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik

# Wait for k3s to start (~30 seconds)
systemctl status k3s

# Verify installation
kubectl get nodes
```

**Expected output:**
```
NAME      STATUS   ROLES                  AGE   VERSION
homelab   Ready    control-plane,master   30s   v1.28.x+k3s1
```

### Why disable Traefik?

k3s includes Traefik ingress controller by default, but we use ingress-nginx for better Pulumi integration and consistency with standard Kubernetes.

## Step 2: Install Pulumi

On your **local machine** (laptop/desktop):

```bash
# Install Pulumi CLI
curl -fsSL https://get.pulumi.com | sh

# Add to PATH
export PATH=$PATH:$HOME/.pulumi/bin

# Verify
pulumi version
```

**Expected output:** `v3.x.x` or later

## Step 3: Install Node.js

Pulumi TypeScript requires Node.js:

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS
brew install node

# Verify
node --version  # Should be v24+
npm --version
```

## Step 4: Clone Repository

```bash
git clone https://github.com/yourusername/homelab.git
cd homelab/infrastructure
npm install
```

This installs Pulumi TypeScript dependencies.

## Step 5: Configure Kubeconfig

Copy k3s kubeconfig from server to your local machine:

```bash
# On k3s server, get kubeconfig
sudo cat /etc/rancher/k3s/k3s.yaml

# On local machine, save to ~/.kube/config
mkdir -p ~/.kube
scp your-server:/etc/rancher/k3s/k3s.yaml ~/.kube/config

# Edit ~/.kube/config
# Change server: https://127.0.0.1:6443
# To: server: https://YOUR_SERVER_IP:6443

# Verify connection
kubectl get nodes
```

**Expected:** Same output as Step 1

## Step 6: Create Cloudflare API Token

1. Go to [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Edit zone DNS" template
4. Permissions:
   - Zone > DNS > Edit
   - Zone > Zone > Read
5. Zone Resources:
   - Include > Specific zone > `yourdomain.com`
6. Create Token and **copy the token** (shown once)

### Get Cloudflare IDs

You'll need Account ID and Zone ID:

```bash
# Account ID: Cloudflare Dashboard → right sidebar
# Zone ID: Cloudflare Dashboard → select domain → right sidebar

# Or via API:
curl -X GET "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer YOUR_API_TOKEN" | jq
```

## Step 7: Configure Pulumi

```bash
cd homelab/infrastructure

# Login to Pulumi Cloud (state backend)
# See ADR 009 for details on state management
pulumi login

# Create new stack (environment)
pulumi stack init dev

# Configure Cloudflare
pulumi config set cloudflare:apiToken YOUR_CF_API_TOKEN --secret
pulumi config set cloudflareAccountId YOUR_ACCOUNT_ID
pulumi config set cloudflareZoneId YOUR_ZONE_ID
pulumi config set domain yourdomain.com

# Optional: Configure NFS storage
# pulumi config set nfsServer 192.168.1.100
# pulumi config set nfsPath /volume1/k3s
```

**Note:** `--secret` encrypts the value in Pulumi state.

**State Backend:** We use Pulumi Cloud for state management. See [ADR 009: Pulumi Cloud State Backend](../adr/009-pulumi-cloud-state-backend.md) for rationale and migration options.

### Verify Configuration

```bash
pulumi config

# Should show:
# cloudflare:apiToken    ********  secret
# cloudflareAccountId    abc123
# cloudflareZoneId       def456
# domain                 yourdomain.com
```

## Step 8: Build Infrastructure Code

Before deploying, compile the TypeScript code:

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory. Pulumi requires the compiled code to run.

**Expected output:**
```
> @mrsimpson/homelab-components@0.1.0 build
> tsc
```

If there are any type errors, they'll be shown here. Fix them before proceeding.

## Step 9: Deploy Core Infrastructure

```bash
pulumi up
```

Pulumi will show a preview of resources to create:

```
Previewing update (dev):
  + pulumi:pulumi:Stack                  homelab-dev          create
  + ├─ kubernetes:helm.sh/v3:Chart      cert-manager         create
  + ├─ kubernetes:helm.sh/v3:Chart      ingress-nginx        create
  + ├─ cloudflare:index:Tunnel          homelab-tunnel       create
  + ├─ kubernetes:apps/v1:Deployment    cloudflared          create
  + └─ ... (~30-40 resources total)

Resources:
  + 38 to create

Do you want to perform this update?
```

Type `yes` and press Enter.

**Deployment takes 2-3 minutes.** Pulumi output shows progress:

```
  +  cert-manager:helm                   created
  +  ingress-nginx:helm                  created
  +  cloudflared:deployment              created
     ...
```

## Step 10: Verify Deployment

```bash
# Check all pods are running
kubectl get pods -A

# Should see:
# NAMESPACE     NAME                              READY   STATUS
# kube-system   ...                               1/1     Running
# cert-manager  cert-manager-xxx                  1/1     Running
# ingress-nginx ingress-nginx-controller-xxx      1/1     Running
# cloudflare    cloudflared-xxx                   1/1     Running

# Check Cloudflare Tunnel is connected
kubectl logs -n cloudflare deployment/cloudflared

# Should see: "Registered tunnel connection"
```

## What Got Deployed

**Core Infrastructure:**
- **cert-manager** - Automatic TLS certificates from Let's Encrypt
- **ingress-nginx** - HTTP(S) routing and load balancing
- **cloudflared** - Cloudflare Tunnel agent (maintains connection to Cloudflare)
- **democratic-csi** (if NFS configured) - Dynamic storage provisioning

**Cloudflare Resources:**
- Cloudflare Tunnel created
- Tunnel credentials stored in Kubernetes Secret

## Step 11: Test with Example App (Optional)

Deploy a test service to verify everything works:

```typescript
// infrastructure/src/apps/test.ts
import { ExposedWebApp } from "../components/ExposedWebApp";

export const testApp = new ExposedWebApp("test", {
  image: "nginxdemos/hello:latest",
  domain: "test.yourdomain.com",
  port: 80
});
```

```bash
# Build the updated code
npm run build

# Deploy
pulumi up

# Wait 30-60 seconds for DNS propagation
curl https://test.yourdomain.com

# Should see: "Server address: ..." (nginx hello page)
```

## Troubleshooting

### k3s not starting

```bash
# Check logs
sudo journalctl -u k3s -f

# Common issues:
# - Port 6443 already in use
# - Not enough disk space
# - Firewall blocking
```

### kubectl can't connect

```bash
# Verify kubeconfig
echo $KUBECONFIG
cat ~/.kube/config

# Check server IP is correct
# Check port 6443 is accessible:
telnet YOUR_SERVER_IP 6443
```

### Pulumi fails with "connection refused"

```bash
# kubectl must work first
kubectl get nodes

# If kubectl works but Pulumi fails:
export KUBECONFIG=~/.kube/config
pulumi up
```

### Pods stuck in "Pending"

```bash
# Check pod details
kubectl describe pod POD_NAME -n NAMESPACE

# Common issues:
# - Image pull errors (check image name)
# - Insufficient resources (check node resources)
# - Storage not available (if using PVC)
```

### Cloudflare Tunnel not connecting

```bash
# Check cloudflared logs
kubectl logs -n cloudflare deployment/cloudflared

# Common issues:
# - Invalid API token
# - Tunnel token incorrect
# - Network connectivity from cluster to internet
```

## Next Steps

- [How to Expose a Web App](expose-web-app.md) - Deploy your first service
- [How to Add OAuth Protection](add-oauth-protection.md) - Secure a service with authentication
- [How to Set Up Persistent Storage](setup-persistent-storage.md) - Configure NFS for stateful apps

## Cleanup (if needed)

To tear down everything:

```bash
# Destroy all Pulumi-managed resources
pulumi destroy

# Uninstall k3s (on server)
/usr/local/bin/k3s-uninstall.sh
```

**Warning:** This deletes all data. Make backups first!
