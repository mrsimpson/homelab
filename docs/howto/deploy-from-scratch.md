# Deploy from Scratch: Bare Metal to Hello World

This guide walks you through the complete setup from a fresh Ubuntu server to a deployed, internet-exposed Hello World application with TLS.

## Prerequisites

- Ubuntu 22.04 or 24.04 server with root access
- Domain name (e.g., `example.com`)
- Cloudflare account with domain configured
- Node.js 24 installed on your workstation

## Part 1: Prepare Cloudflare

### 1.1 Get Cloudflare Credentials

```bash
# Get your Account ID from Cloudflare dashboard
# Settings → Account → Account ID

# Get your Zone ID
# Select your domain → Overview → Zone ID (right sidebar)

# Create an API token
# My Profile → API Tokens → Create Token
# Use "Edit Cloudflare Zero Trust" template
# Permissions needed:
#   - Account.Cloudflare Tunnel: Edit
#   - Zone.DNS: Edit
```

### 1.2 Store Credentials

Save these for later:
- Cloudflare Account ID
- Cloudflare Zone ID
- Cloudflare API Token

## Part 2: Bootstrap k3s on Ubuntu

### 2.1 SSH to Your Server

```bash
ssh user@your-server-ip
```

### 2.2 Install k3s

```bash
# Download and run the k3s installer
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --disable servicelb

# Verify k3s is running
sudo systemctl status k3s

# Verify kubectl works
kubectl get nodes
```

Expected output:
```
NAME       STATUS   ROLES                  AGE   VERSION
homelab    Ready    control-plane,master   30s   v1.28.5+k3s1
```

### 2.3 Copy kubeconfig to Your Workstation

```bash
# On the server
cat /etc/rancher/k3s/k3s.yaml
```

Copy the output. On your **workstation**:

```bash
# Create kubeconfig directory if it doesn't exist
mkdir -p ~/.kube

# Save the kubeconfig (replace SERVER_IP)
cat > ~/.kube/config-homelab <<EOF
[paste the k3s.yaml content here]
EOF

# Update the server address
sed -i 's/127.0.0.1/YOUR_SERVER_IP/g' ~/.kube/config-homelab

# Set KUBECONFIG environment variable
export KUBECONFIG=~/.kube/config-homelab

# Verify connection
kubectl get nodes
```

## Part 3: Configure Pulumi

### 3.1 Install Pulumi

```bash
# macOS
brew install pulumi

# Linux
curl -fsSL https://get.pulumi.com | sh

# Verify
pulumi version
```

### 3.2 Clone and Setup Repository

```bash
# Clone your homelab repository
git clone <your-repo-url>
cd homelab/infrastructure

# Install dependencies
npm install

# Login to Pulumi Cloud
# See ADR 009 for state backend rationale
pulumi login
# Opens browser for authentication (GitHub or email)
# Creates free account automatically

# Create a new stack
pulumi stack init dev
```

**Note:** We use Pulumi Cloud for state management. See [ADR 009: Pulumi Cloud State Backend](../adr/009-pulumi-cloud-state-backend.md) for details.

### 3.3 Configure Stack

```bash
# Set your domain
pulumi config set domain example.com

# Set Cloudflare credentials
pulumi config set cloudflareAccountId <YOUR_ACCOUNT_ID>
pulumi config set cloudflareZoneId <YOUR_ZONE_ID>
pulumi config set --secret cloudflareApiToken <YOUR_API_TOKEN>

# Generate OAuth cookie secret (if you plan to use OAuth later)
pulumi config set --secret oauthCookieSecret $(openssl rand -base64 32)

# Optional: Configure NFS storage (if you have a NAS)
# pulumi config set nfsServer 192.168.1.100
# pulumi config set nfsPath /volume1/k3s
```

### 3.4 Verify Configuration

```bash
pulumi config

# Should show:
# KEY                      VALUE
# cloudflareAccountId      123abc...
# cloudflareApiToken       [secret]
# cloudflareZoneId         456def...
# domain                   example.com
# oauthCookieSecret        [secret]
```

## Part 4: Deploy Infrastructure

### 4.1 Preview Changes

```bash
pulumi preview
```

You should see:
- Cloudflare Tunnel resources
- Kubernetes namespace: `cloudflared`
- Kubernetes deployment: `cloudflared`
- Helm chart: `cert-manager`
- Helm chart: `ingress-nginx`
- Hello World application resources

### 4.2 Deploy

```bash
pulumi up

# Review the plan
# Type "yes" to proceed
```

This will:
1. Create Cloudflare Tunnel
2. Deploy cloudflared daemon to k3s
3. Install cert-manager for TLS certificates
4. Install ingress-nginx for HTTP routing
5. Deploy Hello World application
6. Create DNS record pointing to tunnel
7. Request Let's Encrypt TLS certificate

Deployment takes ~3-5 minutes.

### 4.3 Verify Deployment

```bash
# Check all namespaces
kubectl get namespaces

# Check cert-manager
kubectl get pods -n cert-manager

# Check ingress-nginx
kubectl get pods -n ingress-nginx

# Check cloudflared
kubectl get pods -n cloudflared

# Check hello-world
kubectl get pods -n hello-world

# Check certificate
kubectl get certificate -n hello-world

# Check ingress
kubectl get ingress -n hello-world
```

All pods should be `Running` and certificate should be `Ready`.

### 4.4 Get Application URL

```bash
pulumi stack output helloWorldUrl
```

Example output: `https://hello.example.com`

## Part 5: Access Your Application

### 5.1 Wait for DNS Propagation

```bash
# Check if DNS is resolving
dig hello.example.com

# Or use online tools
# https://dnschecker.org
```

DNS typically propagates within 1-5 minutes.

### 5.2 Access via Browser

Open your browser and navigate to:
```
https://hello.example.com
```

You should see the nginx demo page with:
- ✅ Valid TLS certificate (Let's Encrypt)
- ✅ HTTPS only (HTTP redirects to HTTPS)
- ✅ Accessible from anywhere on the internet

## Part 6: Verify Security

### 6.1 Check TLS Configuration

```bash
# Use SSL Labs (online)
https://www.ssllabs.com/ssltest/analyze.html?d=hello.example.com

# Or use testssl.sh (local)
docker run --rm -ti drwetter/testssl.sh hello.example.com
```

Expected: **A or A+ rating**

### 6.2 Verify No Open Ports

From your workstation (not the server):

```bash
# Scan your server's public IP
nmap -p 1-65535 YOUR_SERVER_IP
```

Expected: Only SSH (port 22) should be open. **No port 80 or 443 exposed.**

The application is accessible via Cloudflare Tunnel's outbound connection only.

## Part 7: Make Changes

### 7.1 Update Configuration

```bash
# Edit the hello-world app
vim packages/apps/hello-world/src/index.ts

# Preview changes
pulumi preview

# Apply changes
pulumi up
```

### 7.2 Deploy Additional Apps

Create a new app file:

```typescript
// packages/apps/my-app/src/index.ts
import { createExposedWebApp } from "@mrsimpson/homelab-core-components";
import { homelabConfig } from "@mrsimpson/homelab-config";
import * as pulumi from "@pulumi/pulumi";

export function createMyApp(homelab: any) {
  const domain = pulumi.interpolate`my-app.${homelabConfig.domain}`;
  
  const app = homelab.createExposedWebApp("my-app", {
    image: "my-app:latest",
    domain,
    port: 3000,
    replicas: 2,
    oauth: {
      provider: "google",
      clientId: "your-client-id",
      clientSecret: pulumi.secret("your-client-secret"),
      allowedEmails: ["admin@example.com"]
    }
  });
  
  return { app, url: pulumi.interpolate`https://${domain}` };
}
```

Import in root `src/index.ts`:

```typescript
import { createMyApp } from "@mrsimpson/homelab-app-my-app";
const myAppResult = createMyApp(homelab);
export const myAppUrl = myAppResult.url;
```

Deploy:

```bash
pulumi up
```

## Troubleshooting

### Certificate Not Issuing

```bash
# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager

# Check certificate status
kubectl describe certificate -n hello-world

# Common issue: DNS not propagated yet
# Wait 5-10 minutes and cert-manager will retry
```

### Application Not Accessible

```bash
# Check pod logs
kubectl logs -n hello-world -l app=hello-world

# Check ingress
kubectl describe ingress -n hello-world

# Check cloudflared logs
kubectl logs -n cloudflared -l app=cloudflared

# Verify DNS
dig hello.example.com
```

### Cloudflare Tunnel Issues

```bash
# Check tunnel status in Cloudflare Dashboard
# Zero Trust → Networks → Tunnels

# Tunnel should show "Healthy" status

# Check cloudflared logs
kubectl logs -n cloudflared -l app=cloudflared
```

### Policy Violations

If deployment fails with policy violations:

```bash
# Review violation details in output
pulumi up

# Common fixes:
# - Add resource limits to containers
# - Ensure securityContext.runAsNonRoot is set
# - Configure TLS on Ingress
```

See [Policy Reference](./policy-reference.md) for all policies.

## Next Steps

- [Add OAuth Protection](./add-oauth-protection.md)
- [Setup Persistent Storage](./setup-persistent-storage.md)
- [Deploy a Database](./deploy-database.md)
- [Monitoring and Observability](./monitoring.md)

## Summary

You now have:
- ✅ k3s cluster running on bare metal Ubuntu
- ✅ Cloudflare Tunnel for secure internet exposure
- ✅ Automatic TLS certificates via Let's Encrypt
- ✅ Working Hello World application
- ✅ No inbound ports exposed
- ✅ Infrastructure fully defined as TypeScript code
- ✅ Policy enforcement for security and best practices

**Total time: ~15-30 minutes** (including DNS propagation)

**Cost: $0** (all open source, Cloudflare Free tier)
