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

SSH into your Linux machine and install k3s.

### 1a: Install Prerequisites for Storage

If you plan to use persistent storage with Longhorn (recommended), install iSCSI tools first:

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y open-iscsi
sudo systemctl enable --now iscsid

# RHEL/CentOS/Fedora
sudo yum install -y iscsi-initiator-utils  # or dnf
sudo systemctl enable --now iscsid

# Verify installation
which iscsiadm
sudo systemctl status iscsid
```

### 1b: Install k3s

Now install k3s:

```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --secrets-encryption

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

### Installation Options Explained

- `--write-kubeconfig-mode 644` - Makes kubeconfig readable without sudo
- `--disable traefik` - We use ingress-nginx instead for better Pulumi integration
- `--secrets-encryption` - **Encrypts all secrets at rest in etcd** (CRITICAL for security)

### Why Enable Secrets Encryption?

The `--secrets-encryption` flag encrypts all Kubernetes secrets (API tokens, passwords, TLS keys) at rest in the etcd datastore using AES-CBC encryption. This protects sensitive data if someone gains unauthorized access to the etcd files on disk.

**What it protects:**
- Cloudflare Tunnel credentials
- OAuth client secrets
- TLS private keys
- Database passwords
- Any other Kubernetes secrets

**Verify encryption is enabled:**
```bash
sudo k3s secrets-encrypt status

# Expected output:
# Encryption Status: Enabled
# Current Rotation Stage: start
```

For more details, see the [k3s secrets encryption documentation](https://docs.k3s.io/security/secrets-encryption).

### Enabling Encryption on Existing k3s Installation

If you already have k3s installed without encryption, you can enable it:

```bash
# Stop k3s
sudo systemctl stop k3s

# Edit k3s service configuration
sudo systemctl edit k3s

# Add these lines in the override section:
[Service]
ExecStart=
ExecStart=/usr/local/bin/k3s server --write-kubeconfig-mode 644 --disable traefik --secrets-encryption

# Save and exit (Ctrl+O, Enter, Ctrl+X)

# Start k3s
sudo systemctl start k3s

# Enable encryption and reencrypt existing secrets
sudo k3s secrets-encrypt prepare
sudo k3s secrets-encrypt enable
sudo k3s secrets-encrypt reencrypt

# Verify all secrets are encrypted
sudo k3s secrets-encrypt status
```

**Note:** This process reencrypts all existing secrets in the cluster. It's safe to do on a running cluster.

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

## Step 6: Set Up Domain with Cloudflare

You need a domain managed by Cloudflare. You have two options:

### Option A: Domain Already Registered with Cloudflare

If you registered your domain directly with Cloudflare Registrar, you're all set! Skip to Step 7.

### Option B: Domain Registered Elsewhere (Transfer DNS to Cloudflare)

If your domain is registered with another provider (GoDaddy, Namecheap, etc.), you need to point it to Cloudflare's nameservers:

1. **Sign up for Cloudflare** (free plan works)
   - Go to [cloudflare.com/sign-up](https://cloudflare.com/sign-up)

2. **Add your domain to Cloudflare**
   - Click "Add a site"
   - Enter your domain: `yourdomain.com`
   - Choose the **Free plan**
   - Cloudflare will scan your existing DNS records

3. **Review DNS records**
   - Cloudflare shows your current DNS records
   - Click "Continue" (records will be preserved)

4. **Get Cloudflare nameservers**
   - Cloudflare assigns you 2 nameservers like:
     ```
     name1.cloudflare.com
     name2.cloudflare.com
     ```
   - **Write these down!**

5. **Update nameservers at your registrar**

   **Example for GoDaddy:**
   - Log in to GoDaddy
   - Go to "My Products" → "Domains"
   - Click your domain → "Manage DNS"
   - Scroll to "Nameservers" → "Change"
   - Select "Custom" and enter Cloudflare's nameservers
   - Save changes

   **Example for Namecheap:**
   - Log in to Namecheap
   - Go to "Domain List"
   - Click "Manage" next to your domain
   - Find "Nameservers" section
   - Select "Custom DNS"
   - Enter Cloudflare's nameservers
   - Save

6. **Wait for DNS propagation**
   - This can take **2-48 hours** (usually 2-4 hours)
   - You'll get an email when it's done
   - Check status: Cloudflare Dashboard → Overview → Status

**Why Cloudflare?**
- Free SSL/TLS
- Free DDoS protection
- Cloudflare Tunnel (no port forwarding needed)
- Fast DNS resolution

## Step 7: Create Cloudflare API Token

**IMPORTANT:** For Cloudflare Tunnel, you need more than just DNS permissions.

### Creating the Token

1. Go to [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **"Create Token"**
3. Click **"Create Custom Token"** (NOT a template - templates don't include Tunnel permissions)

4. **Configure Token:**

   **Token Name:** `homelab-infrastructure`

   **Permissions:** (Click "Add more" to add each)
   - **Account** > **Cloudflare Tunnel** > **Edit** ⚠️ CRITICAL!
   - **Zone** > **DNS** > **Edit**
   - **Zone** > **Zone** > **Read**

   **Account Resources:**
   - Include > **Specific account** > Select your account

   **Zone Resources:**
   - Include > **Specific zone** > Select `yourdomain.com`

   **IP Address Filtering:** (optional)
   - Leave blank or restrict to your IP

   **TTL:** (optional)
   - Leave as default or set expiration based on your security policy

5. Click **"Continue to summary"**
6. Review permissions carefully
7. Click **"Create Token"**
8. **COPY THE TOKEN** - shown only once! Save it somewhere safe.

### Why These Permissions?

- **Cloudflare Tunnel > Edit**: Create and manage tunnels (missing this causes "Authentication error 10000")
- **DNS > Edit**: Create CNAME records pointing to tunnel
- **Zone > Read**: Read zone information

### Troubleshooting Token Issues

**"Authentication error (10000)" when running pulumi up**

This means your token is missing the Cloudflare Tunnel permission. Solutions:

1. **Check your token permissions:**
   - Go to [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Find your token → Click "Edit"
   - Verify "Account > Cloudflare Tunnel > Edit" is present
   - If missing, add it and save

2. **Create a new token:**
   - Follow the steps above
   - Make sure to select **Account > Cloudflare Tunnel > Edit**
   - Update Pulumi config:
     ```bash
     pulumi config set cloudflare:apiToken YOUR_NEW_TOKEN --secret
     ```

3. **Can't find "Cloudflare Tunnel" permission?**
   - It's under **Account** permissions, not Zone permissions
   - Look for "Argo Tunnel" or "Cloudflare Tunnel"
   - Your Cloudflare account must have Tunnel access (all accounts do on Free plan+)

**"Permission denied" or "Invalid token"**

- Token might be expired - create a new one
- Token might have been revoked - check [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
- Wrong token copied - create new token and copy carefully

### Get Cloudflare IDs

You'll need Account ID and Zone ID:

```bash
# Account ID: Cloudflare Dashboard → right sidebar
# Zone ID: Cloudflare Dashboard → select domain → right sidebar

# Or via API:
curl -X GET "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer YOUR_API_TOKEN" | jq
```

## Step 8: Configure Pulumi

```bash
cd homelab/infrastructure

# Login to Pulumi Cloud (state backend)
# See ADR 009 for details on state management
pulumi login

# Create new stack (environment)
pulumi stack init dev

# Configure Cloudflare
pulumi config set cloudflare:apiToken YOUR_CF_API_TOKEN --secret
pulumi config set homelab:cloudflareAccountId YOUR_ACCOUNT_ID
pulumi config set homelab:cloudflareZoneId YOUR_ZONE_ID
pulumi config set homelab:domain yourdomain.com

# Configure Pulumi ESC for External Secrets Operator
# See ADR 008 for details on secrets management
pulumi config set homelab:pulumiOrganization YOUR_PULUMI_ORG
pulumi config set homelab:pulumiAccessToken YOUR_PULUMI_TOKEN --secret

# Optional: Configure NFS storage
# pulumi config set homelab:nfsServer 192.168.1.100
# pulumi config set homelab:nfsPath /volume1/k3s
```

**Note:** `--secret` encrypts the value in Pulumi state.

**State Backend:** We use Pulumi Cloud for state management. See [ADR 009: Pulumi Cloud State Backend](../adr/009-pulumi-cloud-state-backend.md) for rationale and migration options.

**Secrets Backend:** External Secrets Operator uses Pulumi ESC to manage application secrets. See [ADR 008: Secrets Management](../adr/008-secrets-management.md) for architecture details.

### Getting Your Pulumi Organization and Access Token

**Pulumi Organization:**
1. Go to [Pulumi Console](https://app.pulumi.com/)
2. Your organization name is in the URL: `https://app.pulumi.com/<org-name>`

**Pulumi Access Token:**
1. Go to [Pulumi Console → Settings → Access Tokens](https://app.pulumi.com/account/tokens)
2. Click "Create token"
3. Name: `homelab-external-secrets`
4. Expiration: Set based on your security policy
5. Copy the token (shown once)

### Verify Configuration

```bash
pulumi config

# Should show:
# cloudflare:apiToken           ********  secret
# homelab:cloudflareAccountId   abc123
# homelab:cloudflareZoneId      def456
# homelab:domain                yourdomain.com
# homelab:pulumiOrganization    your-org
# homelab:pulumiAccessToken     ********  secret
```

## Step 9: Build Infrastructure Code

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

## Step 10: Deploy Core Infrastructure (Two-Step Process)

Due to cert-manager's validating webhook, we need a two-step deployment:

### Step 10a: First Deployment (Without ClusterIssuer)

```bash
# Skip ClusterIssuer on first deployment to avoid webhook validation errors
pulumi config set homelab:skipClusterIssuer true

# Deploy core infrastructure
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

### Step 10b: Second Deployment (Add ClusterIssuer)

After cert-manager is deployed and running, deploy the ClusterIssuer:

```bash
# Enable ClusterIssuer creation
pulumi config set homelab:skipClusterIssuer false

# Deploy again to create ClusterIssuer
pulumi up
```

This creates the Let's Encrypt ClusterIssuer for automatic TLS certificates.

**Why two steps?** The ClusterIssuer uses cert-manager's validating webhook. On first deployment, the webhook doesn't exist yet, causing preview validation errors. By deploying cert-manager first, then the ClusterIssuer, we avoid this issue.

## Step 11: Verify Deployment

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
- **external-secrets** - External Secrets Operator for centralized secret management
- **democratic-csi** (if NFS configured) - Dynamic storage provisioning

**Cloudflare Resources:**
- Cloudflare Tunnel created
- Tunnel credentials stored in Kubernetes Secret (encrypted at rest)

**Security Features Enabled:**
- **etcd secrets encryption** - All Kubernetes secrets encrypted at rest with AES-CBC
- **Pod Security Standards** - Enforced via namespace labels (restricted/baseline/privileged)
- **TLS everywhere** - Automatic certificate provisioning and renewal
- **No inbound ports** - All traffic routed through Cloudflare Tunnel

## Step 12: Test with Example App (Optional)

Deploy a test service to verify everything works:

```typescript
// packages/apps/test/src/index.ts
import type { HomelabContext } from "@mrsimpson/homelab-core-components";

export function createTestApp(homelab: HomelabContext) {
  const app = homelab.createExposedWebApp("test", {
    image: "nginxdemos/hello:latest",
    domain: "test.yourdomain.com",
    port: 80
  });
  
  return app;
}
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
