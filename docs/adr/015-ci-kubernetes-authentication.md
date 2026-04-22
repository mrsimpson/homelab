# ADR 015: CI Kubernetes Authentication

**Status:** Accepted
**Date:** 2026-04-21
**Deciders:** Platform Team

## Context

This ADR assumes [ADR 013: Tailscale for CI/CD Cluster Access](./013-tailscale-cicd-cluster-access.md) is in place — CI runners can reach the Kubernetes API server over the Tailscale VPN.

Now we must decide: **what credentials go into the kubeconfig that CI uses?**

The kubeconfig contains:
- A token (the credential)
- A cluster reference (server URL + CA certificate)
- A context (binding user + cluster + namespace)

This ADR addresses **how CI authenticates** — specifically the token strategy. The token must:
- Be usable from GitHub Actions (no interactive login)
- Not expire during a typical CI pipeline run
- Not require manual intervention to renew
- Scope access to the app's namespace only (least privilege)

## Decision

We use **long-lived ServiceAccount tokens** backed by Kubernetes Secrets.

1. A ServiceAccount named `ci` is created in the app's namespace
2. A Kubernetes Secret of type `kubernetes.io/service-account-token` is created and annotated with the SA name — Kubernetes automatically populates it with a non-expiring token
3. A `Role` grants the SA permissions typical for CI deployments (pods, services, deployments, jobs, etc.)
4. A `RoleBinding` binds the Role to the SA
5. The token is read from the Secret and stored as a GitHub Actions secret
6. CI pipelines use this kubeconfig to run `pulumi up`

A helper script (`scripts/create-kubeconfig.sh`) automates steps 1-5 idempotently.

### Bootstrap Process

Since the namespace is created by the first `pulumi up` (via ExposedWebApp), the flow is:

1. Developer runs `pulumi up` locally → namespace created by ExposedWebApp
2. Developer runs `scripts/create-kubeconfig.sh <namespace>` → creates SA/Role/RoleBinding, outputs kubeconfig
3. Developer copies kubeconfig to CI secrets
4. Subsequent deploys run via GitHub Actions using the stored kubeconfig

The first deploy must be manual. This is acceptable — it's a one-time bootstrap step per app.

## Consequences

### Positive

- **Non-expiring token** — once created, the token in the Secret never expires; CI never breaks silently due to token rotation
- **Simple to understand** — the kubeconfig pattern is familiar; no OIDC complexity
- **Namespace-scoped** — Role limits blast radius to the app's namespace
- **Idempotent provisioning** — the script can be re-run safely; it creates resources only if missing
- **Portable** — the kubeconfig works from any machine with kubectl + Tailscale, not just CI

### Negative

- **Long-lived credential** — if leaked, the token remains valid until the Secret is deleted; must protect the GitHub secret
- **Bootstrap required** — first deploy cannot run in CI; requires manual local `pulumi up`
- **Manual rotation** — if compromised, operator must delete the Secret to revoke (script can regenerate)

### Neutral

- Token lives in a Kubernetes Secret — Kubernetes manages the Secret object; we just read it
- The script is a one-time per-app setup; subsequent runs only fetch a fresh token (the Secret is auto-populated by Kubernetes)

## Alternatives Considered

### Short-lived Bound Tokens (`kubectl create token`)

Rejected because:
- Tokens expire (default 1 hour, max 24h)
- Once expired, CI pipelines fail with authentication errors
- Requires CI to fetch a fresh token before every run, adding complexity
- Silent failure mode — expired tokens cause confusing "Unauthorized" errors

### OIDC Federation (GitHub Actions → k3s)

Deferred for future consideration because:
- Requires k3s API server reconfiguration with OIDC flags (`oidc-issuer-url`, `oidc-client-id`, etc.)
- k3s must be able to reach `https://token.actions.githubusercontent.com` to fetch JWKS
- More complex initial setup
- RBAC subjects become GitHub-specific strings (`repo:owner/repo:ref:refs/heads/main`)

However, OIDC is the **recommended long-term upgrade path** because:
- No stored credentials at all
- Ephemeral tokens that exist only for the workflow run duration
- Fine-grained claims (repo, branch, environment, actor)
- No token rotation concerns

### In-Cluster ServiceAccount + Image Pull Secret

Out of scope for this ADR. Apps that need to pull images from private registries handle that separately via the `imagePullSecrets` option in ExposedWebApp, which creates ExternalSecrets referencing Pulumi ESC credentials.

## Implementation

The helper script is at `scripts/create-kubeconfig.sh`.

Usage:
```bash
# Creates SA "ci" with deployment Role, outputs kubeconfig
./scripts/create-kubeconfig.sh my-app-namespace

# Custom SA name (for special apps)
./scripts/create-kubeconfig.sh code opencode-router
```

Environment variables:
- `TOKEN_DURATION` — ignored for Secret-based tokens (they don't expire), kept for API compatibility
- `KUBECONFIG_OUT` — output path (default: `/tmp/<namespace>-ci.kubeconfig`)

## References

- [ADR 013: Tailscale for CI/CD Cluster Access](./013-tailscale-cicd-cluster-access.md)
- [Kubernetes ServiceAccount Tokens](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/#service-account-token-secrets)
- [kubectl create token](https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands#create-token)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
