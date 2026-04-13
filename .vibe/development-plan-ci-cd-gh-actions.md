# Development Plan: homelab (ci-cd-gh-actions branch)

*Generated on 2026-04-13 by Vibe Feature MCP*
*Workflow: [epcc](https://mrsimpson.github.io/responsible-vibe-mcp/workflows/epcc)*

## Goal

Enable GitHub Actions CI/CD pipelines from external application repositories to deploy to the homelab Kubernetes cluster (k3s on local intranet) by exposing the cluster's Kubernetes API securely via Tailscale.

## Explore
<!-- beads-phase-id: homelab-6.1 -->

### Current State

- The homelab runs a **k3s cluster** on a local intranet (not publicly accessible)
- The cluster is exposed to the internet via a **Cloudflare Tunnel** (for HTTP/S app traffic only)
- Separate application repositories exist (per ADR 007) and need to run `pulumi up` to deploy
- Pulumi state is stored in **Pulumi Cloud** (accessible from GitHub Actions)
- Pulumi needs a **kubeconfig** to reach the cluster's Kubernetes API (port 6443)
- GitHub Actions runners are on GitHub's cloud infrastructure — they cannot reach the local intranet directly
- The existing `publish-components.yml` workflow only publishes the npm package; no deployment workflow exists yet

### The Problem

`pulumi up` in external repos must connect to the **Kubernetes API** (not just HTTP routes):
- The Kubernetes API (`https://<cluster-ip>:6443`) is on the local LAN only
- Cloudflare Tunnel only forwards HTTP/S application traffic — it cannot proxy arbitrary TCP (Kubernetes API TLS)
- GitHub Actions runners are ephemeral cloud VMs that have no VPN/intranet access

### Proposed Solution: Tailscale

Tailscale creates a WireGuard-based mesh VPN (overlay network). By installing Tailscale on:
1. **The k3s node(s)** — they join the Tailscale network and get a stable `100.x.x.x` (or MagicDNS) address
2. **GitHub Actions runner** — using the `tailscale/github-action` action, the ephemeral runner joins the same tailnet for the duration of the workflow

This allows the GitHub Actions runner to reach the Kubernetes API at its Tailscale IP, enabling `pulumi up` to succeed.

### How It Works (End-to-End)

```
External App Repo (GitHub)
         │
         │  git push / workflow_dispatch
         ▼
GitHub Actions Runner (cloud)
    1. Install Tailscale (tailscale/github-action)
    2. Join tailnet using OAuth client credentials
    3. Runner gets a Tailscale IP, can reach cluster
         │
         │  WireGuard tunnel over internet
         ▼
k3s cluster node (intranet, also on Tailscale)
    - Kubernetes API on :6443
    - kubeconfig updated to use Tailscale IP/DNS
         │
         ▼
pulumi up → kubectl API calls → deploy to cluster
```

### Prerequisites & Decisions Needed

1. **Tailscale account** (free tier works for homelab): https://tailscale.com
2. **Tailscale installed on k3s node(s)**
3. **kubeconfig updated** to use the Tailscale hostname/IP of the cluster API server
4. **Tailscale OAuth app** created (for headless GitHub Actions auth — avoids using personal auth keys that expire)
5. **GitHub Actions secret** `TS_OAUTH_CLIENT_ID` + `TS_OAUTH_CLIENT_SECRET` stored in org or per-repo
6. **Pulumi access token** (`PULUMI_ACCESS_TOKEN`) for Pulumi Cloud state — already needed
7. **k3s kubeconfig** stored as GitHub Actions secret (`KUBECONFIG`) — uses Tailscale address
8. **ACL policy** on Tailscale: restrict runners to only access the API server port (optional but recommended)

### What needs to be built

1. **Documentation / ADR** explaining the Tailscale-based cluster access pattern
2. **Reusable GitHub Actions workflow** (in this repo, callable from external repos) that:
   - Sets up Tailscale
   - Configures kubeconfig
   - Runs `pulumi up`
3. **Setup guide** for operators: how to install Tailscale on the cluster node and create OAuth credentials
4. **Tailscale ACL snippet** (optional, for least-privilege)

### Tasks

*Tasks managed via `bd` CLI*

## Plan
<!-- beads-phase-id: homelab-6.2 -->

### Phase Entrance Criteria
- [x] The problem (GitHub Actions cannot reach local k3s API) is clearly understood
- [x] The solution approach (Tailscale mesh VPN) has been evaluated and chosen
- [x] Key components are identified: Tailscale on cluster node, OAuth credentials, reusable workflow
- [x] What needs to be built is clearly defined (ADR, reusable workflow, setup guide)

### Deliverable Design

#### 1. ADR 013: Tailscale for CI/CD Cluster Access
**File:** `docs/adr/013-tailscale-cicd-cluster-access.md`
**Structure:** Follows existing ADR format (Status, Context, Decision, Consequences, Alternatives Considered)
**Key content:**
- Context: K8s API is LAN-only; Cloudflare Tunnel can't proxy arbitrary TCP
- Decision: Tailscale mesh VPN with OAuth client credentials for CI
- Alternatives: self-hosted runners (rejected: permanent infra overhead), Cloudflare Tunnel TCP (rejected: not supported), WireGuard direct (rejected: more complex to manage)

#### 2. Reusable GitHub Actions Workflow
**File:** `.github/workflows/deploy-to-cluster.yml`
**Type:** `workflow_call` (reusable) — called from external app repos with `uses: owner/homelab/.github/workflows/deploy-to-cluster.yml@main`

**Inputs:**
| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `pulumi-stack` | string | yes | Fully qualified stack name, e.g. `org/myapp/dev` |
| `working-directory` | string | no | Path to Pulumi project (default: `deployment`) |
| `pulumi-command` | string | no | `up` or `preview` (default: `up`) |

**Secrets (inherited by caller):**
| Secret | Description |
|--------|-------------|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID |
| `TS_OAUTH_CLIENT_SECRET` | Tailscale OAuth client secret |
| `KUBECONFIG` | base64-encoded k3s kubeconfig (using Tailscale address) |
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud access token |

**Steps:**
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 24)
3. `npm ci` in working-directory
4. `tailscale/github-action@v3` (ephemeral, tagged with `ci`)
5. Write kubeconfig from secret to `~/.kube/config`
6. `pulumi/${{ inputs.pulumi-command }}` via `pulumi/actions@v5`

#### 3. How-To Guide: Setup Tailscale for CI/CD
**File:** `docs/howto/setup-tailscale-cicd.md`
**Sections:**
1. Overview diagram (runner → Tailscale → cluster)
2. Prerequisites
3. Cluster-side setup (install Tailscale, `tailscale up`, find Tailscale IP)
4. Update kubeconfig to use Tailscale address
5. Create Tailscale OAuth client (admin console steps)
6. Extract & store kubeconfig as GitHub secret
7. Store Tailscale credentials as GitHub secrets
8. Verify connectivity
9. Tailscale ACL recommendation (restrict to port 6443)

#### 4. Update: External App Deployment Guide
**File:** `docs/howto/deploy-custom-app-external-repo.md`
**Change:** Add new Step 9 after "Update Your Application" — "Automate Deployment via GitHub Actions" — showing how to call the reusable workflow from an external repo's own CI

### Tasks

*Tasks managed via `bd` CLI*

## Code
<!-- beads-phase-id: homelab-6.3 -->

### Phase Entrance Criteria
- [ ] A concrete plan exists with specific files to create/modify
- [ ] The reusable workflow design is finalized (inputs, secrets, steps)
- [ ] It's clear where the workflow should live (`.github/workflows/` in this repo)
- [ ] Setup instructions scope is defined (cluster-side Tailscale setup + GitHub side)

### Tasks

*Tasks managed via `bd` CLI*

## Commit
<!-- beads-phase-id: homelab-6.4 -->

### Phase Entrance Criteria
- [ ] Reusable GitHub Actions workflow created and tested (or at minimum reviewed)
- [ ] Setup documentation written
- [ ] ADR created documenting the decision to use Tailscale for CI/CD cluster access
- [ ] Howto guide written for external app repos to adopt the workflow

### Tasks

*Tasks managed via `bd` CLI*

## Key Decisions

- **Tailscale over alternatives**: Cloudflare Tunnel can't proxy K8s API (arbitrary TLS TCP); self-hosted GitHub Actions runners require permanent infra; Tailscale is lightweight and runs on the cluster node itself
- **OAuth Client credentials**: Preferred over auth keys because they don't expire and are more secure for CI use cases
- **Reusable workflow**: Centralizing the deployment workflow in this repo avoids duplication across all external app repos

## Notes

- Tailscale free tier supports up to 100 devices and 3 users — more than sufficient for homelab
- The Tailscale `tailscale/github-action` action handles the full lifecycle (join + cleanup on job end)
- k3s kubeconfig by default uses `127.0.0.1` — needs to be updated to use the Tailscale IP for remote access
- **Use the raw Tailscale IP (not MagicDNS hostname)** — GitHub Actions runners cannot resolve MagicDNS via their system resolver (`127.0.0.53`)
- Pulumi Cloud state backend is already used (ADR 009), so `PULUMI_ACCESS_TOKEN` is the only additional secret needed beyond kubeconfig
- OAuth client scope must be `auth_keys` (not just `devices:write`) — the `tailscale/github-action` uses the OAuth secret directly as an auth key via `tailscale up --auth-key`
- `tailscale/github-action@v3` does not have an `ephemeral` input — ephemeral behaviour is controlled by the OAuth client scope

## Follow-up: Harden kubeconfig TLS verification

**Status: deferred — pipeline is working with `insecure-skip-tls-verify: true`**

The k3s API server certificate was generated with SANs for `127.0.0.1` and `192.168.13.5`
only — it does not include the Tailscale IP `100.70.179.36`. As a temporary workaround the
kubeconfig stored in the `KUBECONFIG` GitHub secret uses `insecure-skip-tls-verify: true`.

To fix properly (requires sudo on `flinker`):

```bash
# 1. Tell k3s to include the Tailscale IP in future TLS certs
sudo tee /etc/rancher/k3s/config.yaml <<'EOF'
tls-san:
  - 100.70.179.36
  - 192.168.13.5
  - 127.0.0.1
EOF

# 2. Delete only the API server leaf cert (safe — regenerated on restart)
sudo rm /var/lib/rancher/k3s/server/tls/serving-kube-apiserver.crt \
        /var/lib/rancher/k3s/server/tls/serving-kube-apiserver.key

# 3. Restart k3s
sudo systemctl restart k3s

# 4. Verify the new cert includes the Tailscale IP
echo | openssl s_client -connect 100.70.179.36:6443 2>/dev/null | \
  openssl x509 -noout -text | grep -A2 "Subject Alternative"
```

Then rebuild the `KUBECONFIG` secret **without** `insecure-skip-tls-verify`:
```bash
kubectl config view --raw --minify --context=flinker > /tmp/homelab-ci.yaml
sed -i '' 's|https://192.168.13.5:6443|https://100.70.179.36:6443|g' /tmp/homelab-ci.yaml
KUBECONFIG_B64=$(base64 -i /tmp/homelab-ci.yaml | tr -d '\n')
gh secret set KUBECONFIG -R mrsimpson/homelab  --body "$KUBECONFIG_B64"
gh secret set KUBECONFIG -R mrsimpson/opencode --body "$KUBECONFIG_B64"
```

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
