# How to: Setup Tailscale for CI/CD Cluster Access

This guide walks you through the one-time setup required to let GitHub Actions runners
deploy to the homelab k3s cluster via Tailscale.

For the architectural rationale, see [ADR 013: Tailscale for CI/CD Cluster Access](../adr/013-tailscale-cicd-cluster-access.md).

## Overview

```
External App Repo (GitHub)
        │  git push / workflow_dispatch
        ▼
GitHub Actions Runner (cloud VM)
   1. tailscale/github-action → runner joins your tailnet (ephemeral)
   2. kubeconfig written from GitHub secret
   3. pulumi up / preview runs
        │
        │  WireGuard tunnel (encrypted, over public internet)
        ▼
k3s node (your intranet, also on Tailscale)
   Kubernetes API reachable at its Tailscale address (:6443)
        │
        ▼
Pulumi deploys to cluster ✅
```

## Prerequisites

- A running k3s cluster (see [setup-cluster.md](./setup-cluster.md))
- SSH access to the k3s node
- A [Tailscale account](https://tailscale.com) (free tier is sufficient)
- GitHub organization or repository admin access (to store secrets)

---

## Why Tailscale is not managed by Pulumi

Tailscale runs as a **host-level systemd daemon** (`tailscaled`) on the Linux node — it
operates at the layer *below* Kubernetes. Pulumi in this stack manages Kubernetes objects
via the k8s provider; it cannot install or configure OS-level daemons on the underlying node.
This is the same reason k3s itself is not installed by Pulumi.

The right split is:
- **Manual / OS-level**: install `tailscaled`, run `tailscale up` once, apply tags
- **Pulumi-managed** (future): Tailscale ACL policy via the Tailscale Pulumi provider,
  codifying `tag:ci` and `tag:k8s-node` rules as infrastructure-as-code

---

## Step 1: Install Tailscale on the k3s Node

> **If Tailscale is already installed and active on the node, skip to Step 1c.**
> Verify with: `ssh <node> "tailscale status --self"`

SSH into the k3s node and run:

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start and authenticate (opens a browser URL)
sudo tailscale up --advertise-tags=tag:k8s-node

# A URL will be printed — open it in your browser to authenticate.
```

### Step 1b: Verify the node is on the tailnet

```bash
# Get the Tailscale IP assigned to this node
tailscale ip -4
# Example output: 100.70.179.36

# Get the stable MagicDNS hostname
tailscale status --json | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'])"
# Example output: flinker.han-enigmatic.ts.net.  (drop the trailing dot)
```

> **Tip:** Use the **MagicDNS hostname** (`hostname.tailnet-name.ts.net`) rather than the
> raw IP. If the IP ever changes (e.g. after reinstall), the hostname stays the same and
> you don't need to update your kubeconfig or GitHub secrets.

Enable MagicDNS in the [Tailscale admin console](https://login.tailscale.com/admin/dns) if not already on.

### Step 1c: Apply the `tag:k8s-node` tag (if not already applied)

The ACL policy in Step 4 uses this tag to restrict CI devices to port 6443 only.

```bash
sudo tailscale up --advertise-tags=tag:k8s-node
```

> **Note:** Tags must be pre-defined in your Tailscale ACL before `tailscale up` accepts them.
> See Step 4 to add `tagOwners` first if you get an "invalid tag" error.

---

## Step 2: Update the kubeconfig to Use the Tailscale Address

By default, k3s writes a kubeconfig with `server: https://127.0.0.1:6443`.
This only works locally. Replace it with the node's Tailscale MagicDNS hostname:

```bash
# On your local machine — copy the current k3s kubeconfig for the homelab context
kubectl config view --raw --minify --context=<your-homelab-context> > ~/.kube/config-homelab-ci

# Replace the LAN IP or 127.0.0.1 with the Tailscale MagicDNS hostname
# (from Step 1b — e.g. flinker.han-enigmatic.ts.net)
sed -i '' 's|https://192.168.13.5:6443|https://flinker.han-enigmatic.ts.net:6443|g' \
  ~/.kube/config-homelab-ci

# Verify
grep server ~/.kube/config-homelab-ci
# Should show: server: https://flinker.han-enigmatic.ts.net:6443
```

---

## Step 3: Create a Tailscale OAuth Client

Tailscale OAuth clients are **non-expiring** credentials — unlike auth keys which expire
after up to 90 days. This makes them the right choice for CI.

1. Go to the [Tailscale admin console → Settings → OAuth clients](https://login.tailscale.com/admin/settings/oauth)
2. Click **"Generate OAuth client"**
3. Configure the client:
   - **Description:** `GitHub Actions CI`
   - **Scopes:** `devices:write` (allows the client to register ephemeral devices)
   - **Tags:** Select or create `tag:ci` (see Step 4 for ACL setup)
4. Click **"Generate client"**
5. Copy both the **Client ID** and **Client Secret** — the secret is shown only once

> **Security note:** The OAuth client can only register new *ephemeral* devices tagged
> with the tags you specify. It cannot access existing devices or your data.

---

## Step 4: (Recommended) Restrict CI Devices via Tailscale ACL

Add a rule to your [Tailscale ACL](https://login.tailscale.com/admin/acls) to restrict
`tag:ci` devices to only reaching the Kubernetes API port on the cluster node:

```json
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"]
  },
  "acls": [
    // ... your existing rules ...

    // CI runners may only reach the k3s API server port on the cluster node
    {
      "action": "accept",
      "src":    ["tag:ci"],
      "dst":    ["tag:k8s-node:6443"]
    }
  ]
}
```

Also tag your k3s node with `tag:k8s-node`:

```bash
sudo tailscale up --advertise-tags=tag:k8s-node
```

This ensures that even if a CI secret is compromised, the attacker can only reach
the Kubernetes API — not other hosts on your LAN or tailnet.

---

## Step 5: Encode the kubeconfig as Base64

The kubeconfig is stored as a base64-encoded GitHub secret:

```bash
# Encode the kubeconfig (the one edited in Step 2 with the Tailscale address)
base64 -w0 ~/.kube/config-homelab
# -w0 disables line wrapping (important — GitHub secrets must be single-line)

# On macOS (no -w flag):
base64 -i ~/.kube/config-homelab | tr -d '\n'
```

Copy the output — you'll need it in the next step.

---

## Step 6: Store Secrets in GitHub

Store the following secrets either at the **organization level** (shared by all app repos)
or at the **repository level** (per-app):

| Secret name | Value |
|---|---|
| `TS_OAUTH_CLIENT_ID` | Client ID from Step 3 |
| `TS_OAUTH_CLIENT_SECRET` | Client Secret from Step 3 |
| `KUBECONFIG` | base64-encoded kubeconfig from Step 5 |
| `PULUMI_ACCESS_TOKEN` | Your [Pulumi Cloud access token](https://app.pulumi.com/account/tokens) |

### Adding org-level secrets (recommended for multiple app repos)

1. Go to your GitHub organization → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New organization secret"**
3. Add each secret above
4. Set **Repository access** to "All repositories" or select specific repos

### Adding repo-level secrets

1. Go to the repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"**
3. Add each secret above

---

## Step 7: Verify the Setup

You can test the connectivity manually from any device already on your tailnet:

```bash
# Make sure you're connected to Tailscale
tailscale status

# Test kubectl works via Tailscale address
KUBECONFIG=~/.kube/config-homelab kubectl get nodes

# Expected output:
# NAME      STATUS   ROLES                  AGE   VERSION
# homelab   Ready    control-plane,master   ...   v1.x.x+k3s1
```

---

## Using the Reusable Workflow in External App Repos

Once the setup above is done, external app repos can deploy to the cluster with minimal
workflow code. See [deploy-custom-app-external-repo.md](./deploy-custom-app-external-repo.md)
for the full pattern, but in short:

```yaml
# .github/workflows/deploy.yml (in your external app repo)
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    uses: mrsimpson/homelab/.github/workflows/deploy-to-cluster.yml@main
    with:
      # "name:" from your Pulumi.yaml → mrsimpson/<that-name>/dev
      # e.g. Pulumi.yaml: "name: opencode" → pulumi-stack: mrsimpson/opencode/dev
      # Do NOT use mrsimpson/homelab/dev — that is the base infra stack.
      pulumi-stack: mrsimpson/<your-app>/dev
      # Path to the folder containing your Pulumi.yaml
      working-directory: deployment/homelab
      pulumi-command: ${{ github.event_name == 'pull_request' && 'preview' || 'up' }}
    secrets: inherit
```

---

## Troubleshooting

### Runner can't reach the cluster API

```
Error: dial tcp 100.64.0.5:6443: connect: connection refused
```

**Check:**
1. Is Tailscale running on the k3s node? `sudo systemctl status tailscaled`
2. Is the node still on the tailnet? Check [admin console → Machines](https://login.tailscale.com/admin/machines)
3. Is the Tailscale address in the kubeconfig correct? Compare with `tailscale ip -4` on the node
4. Is there a firewall on the node blocking port 6443 from Tailscale IPs?
   ```bash
   sudo ufw status
   # If ufw is active, allow from Tailscale subnet:
   sudo ufw allow from 100.64.0.0/10 to any port 6443
   ```

### ACL blocking access

```
Error: connection to server was refused
```

If you set up ACL restrictions in Step 4, verify:
- The CI device has `tag:ci` applied (check the OAuth client configuration)
- The k3s node has `tag:k8s-node` applied (`tailscale status --self`)
- The ACL rule allows `tag:ci → tag:k8s-node:6443`

### OAuth client "invalid_client" error

- Verify the Client ID and Secret are stored correctly in GitHub secrets (no extra whitespace)
- Check that the OAuth client still exists in the [Tailscale admin console](https://login.tailscale.com/admin/settings/oauth)
- OAuth clients are not shown again after creation — if lost, create a new one and update the secrets

### Pulumi state access denied

```
error: failed to load checkpoint: 403 Forbidden
```

- Verify `PULUMI_ACCESS_TOKEN` is set and valid
- Check the token at [Pulumi Console → Account → Access Tokens](https://app.pulumi.com/account/tokens)
- Ensure the token has access to the organization specified in `pulumi-stack`

---

## References

- [Tailscale GitHub Action](https://github.com/tailscale/github-action)
- [Tailscale OAuth Clients documentation](https://tailscale.com/kb/1215/oauth-clients)
- [Tailscale ACL documentation](https://tailscale.com/kb/1018/acls)
- [ADR 013: Tailscale for CI/CD Cluster Access](../adr/013-tailscale-cicd-cluster-access.md)
