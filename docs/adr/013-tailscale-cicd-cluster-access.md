# ADR 013: Tailscale for CI/CD Cluster Access

**Status:** Accepted
**Date:** 2026-04-13
**Deciders:** Platform Team

## Context

External application repositories (per [ADR 007](./007-separate-app-repositories.md)) need to run `pulumi up` from GitHub Actions to deploy to the homelab Kubernetes cluster. This requires the GitHub Actions runner to reach the **Kubernetes API server** (`https://<node-ip>:6443`).

The cluster runs k3s on a **local intranet** with no publicly routable address. The existing internet exposure via **Cloudflare Tunnel** (per [ADR 002](./002-cloudflare-tunnel-exposure.md)) only forwards HTTP/S application traffic — it cannot proxy arbitrary TLS TCP connections such as the Kubernetes API.

GitHub Actions runners are ephemeral cloud VMs on GitHub's infrastructure. They have no VPN or intranet access by default.

### Requirements

- GitHub Actions runners must be able to reach the Kubernetes API server on port 6443
- The solution must work with ephemeral runners (no persistent state)
- Credentials must not expire (CI must not break due to token rotation)
- The solution should not require permanent infrastructure beyond what already exists
- Minimal blast radius: compromise of a CI credential should not expose the entire LAN

## Decision

We use **Tailscale** to create a WireGuard-based mesh VPN between the k3s cluster node and GitHub Actions runners.

1. **Tailscale is installed on the k3s node** — it joins the tailnet and gets a stable address (Tailscale IP `100.x.x.x` or MagicDNS hostname)
2. **The k3s kubeconfig is updated** to point the API server address to the Tailscale hostname instead of `127.0.0.1`
3. **A Tailscale OAuth client** (non-expiring) is created for CI use
4. **GitHub Actions uses `tailscale/github-action`** to ephemerally join the tailnet for the duration of the workflow job, then automatically disconnects and removes the device

The **kubeconfig** (with the Tailscale API server address) is stored as a GitHub Actions secret. It is only usable when the runner is on the tailnet.

### Reusable Workflow

A reusable `workflow_call` workflow in this repository (`.github/workflows/deploy-to-cluster.yml`) centralizes the Tailscale setup and Pulumi invocation. External app repos call it with `uses:`, avoiding duplication.

## Consequences

### Positive

- **No permanent infrastructure** — Tailscale agent runs on the existing k3s node; no extra VMs
- **Non-expiring credentials** — OAuth client credentials (vs. auth keys) do not expire, so CI never breaks due to key rotation
- **Ephemeral runners** — Tailscale device is automatically removed after the job; no stale devices accumulate
- **Least-privilege** — Tailscale ACL can restrict CI devices to only port 6443 on the cluster node; they cannot access other LAN hosts
- **Reusable workflow** — Single source of truth for deployment logic; external repos stay minimal
- **MagicDNS** — Stable hostname even if Tailscale IP changes; kubeconfig doesn't need updating

### Negative

- **External dependency** — Tailscale outage blocks CI deployments (mitigated: deployments can still be run manually from any tailnet device)
- **Tailscale account required** — Free tier is sufficient but adds an external service dependency
- **Secret management** — Kubeconfig and Tailscale OAuth credentials must be stored as GitHub secrets and kept in sync if the cluster changes
- **Learning curve** — Operators unfamiliar with Tailscale need onboarding (mitigated by the setup guide)

### Neutral

- Tailscale free tier supports up to 100 devices and 3 users — more than sufficient for homelab scale
- MagicDNS hostnames follow the pattern `<hostname>.<tailnet-name>.ts.net`

## Alternatives Considered

### Self-Hosted GitHub Actions Runners

**Rejected** because:
- Requires a permanently running VM/container on the intranet acting as the runner
- Adds permanent infrastructure to maintain, patch, and monitor
- Single point of failure; if the runner VM goes down, all CI stops
- Operational overhead outweighs the benefit for a homelab scale project

### Cloudflare Tunnel TCP Proxy

**Rejected** because:
- Cloudflare Tunnel is designed for HTTP/S; while TCP tunneling exists via `cloudflared access tcp`, it requires the Cloudflare WARP client or `cloudflared` on the runner
- The Kubernetes API uses mutual TLS which conflicts with Cloudflare's TLS termination approach
- More complex to configure correctly compared to Tailscale
- Not a clean fit given the existing Cloudflare Tunnel usage for HTTP/S app traffic

### Direct WireGuard VPN

**Rejected** because:
- WireGuard requires static peer configurations; adding ephemeral runners as peers requires dynamic config management
- No managed key distribution — operators must manually manage public keys for each runner
- Tailscale is WireGuard under the hood but adds the key exchange, peer discovery, and ephemeral device management that raw WireGuard lacks

### ngrok / frp / localtunnel

**Rejected** because:
- These tools are designed for HTTP tunneling; TCP support is limited or paid
- Not designed for the security posture needed for a Kubernetes API server
- Additional accounts/services to manage

## Implementation

See [How-to: Setup Tailscale for CI/CD](../howto/setup-tailscale-cicd.md) for step-by-step operator instructions.

The reusable workflow is at `.github/workflows/deploy-to-cluster.yml` in this repository.

## References

- [Tailscale GitHub Action](https://github.com/tailscale/github-action)
- [Tailscale OAuth Clients](https://tailscale.com/kb/1215/oauth-clients)
- [ADR 002: Cloudflare Tunnel](./002-cloudflare-tunnel-exposure.md)
- [ADR 007: Separate Application Repositories](./007-separate-app-repositories.md)
- [ADR 009: Pulumi Cloud State Backend](./009-pulumi-cloud-state-backend.md)
