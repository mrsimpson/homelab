# Critical Review: Homelab Infrastructure

**Review Date:** 2024-12-22
**Last Updated:** 2025-12-25
**Reviewers:** Security, Ops, and Developer Perspectives

---

## 📊 Status Update (2025-12-25)

**Progress:** 4 issues resolved, 2 partially resolved, 34 remaining → [View open issues](https://github.com/mrsimpson/homelab/issues)

**Grade:** B+ (up from B-)

### ✅ Resolved Since Review

1. **Issue #5 - Pod Security Standards** ✅
   - Status: Implemented across all namespaces
   - Location: All infrastructure + ExposedWebApp component

2. **Issue #2 - etcd Encryption** ✅ [Issue #17](https://github.com/mrsimpson/homelab/issues/17)
   - Status: `--secrets-encryption` added to setup guide
   - Location: docs/howto/setup-cluster.md:23

3. **Monorepo Structure** ✅
   - Status: Complete separation with packages/core, packages/stacks, packages/apps

4. **External Secrets Operator** ✅
   - Status: Deployed with Pulumi ESC backend
   - Location: packages/core/infrastructure/src/external-secrets/

### 🔶 Partially Resolved

- **Issue #1 - Secrets Management** - ESO deployed, migration to ESC incomplete
- **Config Management** - Centralized config package created

### ❌ Critical Issues Still Open

- [#16](https://github.com/mrsimpson/homelab/issues/16) - No network policies (HIGH RISK)
- [#13](https://github.com/mrsimpson/homelab/issues/13) - No observability stack (CRITICAL)
- [#14](https://github.com/mrsimpson/homelab/issues/14) - No backup strategy (CRITICAL)
- [#19](https://github.com/mrsimpson/homelab/issues/19) - No local development mode

---

## Original Review (2024-12-22)

## 🔒 Security Engineer Perspective

**Objective:** Security is non-compromisable

### ✅ Strengths

1. **No Inbound Ports** - Cloudflare Tunnel eliminates traditional attack surface
2. **TLS Everywhere** - cert-manager + Let's Encrypt enforced via policy
3. **OAuth2 Proxy Pattern** - Authentication abstracted into reusable component
4. **Policy as Code** - 19 automated security checks at deployment time
5. **Non-Root Containers** - Enforced by policy (runAsNonRoot: true)
6. **Resource Limits** - Prevents resource exhaustion attacks

### ❌ Critical Issues

#### 1. **Secrets Management - HIGH RISK**
- **Problem:** Pulumi config secrets stored in stack files (base64, no rotation)
- **Risk:** Compromised laptop = all production secrets
- **Impact:** Cloudflare API tokens, OAuth secrets, tunnel tokens exposed
- **Fix Required:** External secrets management (SOPS, Vault, External Secrets Operator)

#### 2. **Cloudflare Tunnel Token in Kubernetes Secret - HIGH RISK**
```typescript
// Current: Plain Kubernetes Secret
new k8s.core.v1.Secret("tunnel-token", {
  stringData: { token: tunnelToken }  // Base64 in etcd
});
```
- **Problem:** etcd not encrypted at rest, cluster compromise = tunnel compromise
- **Risk:** Attacker gets tunnel token → can route traffic through your tunnel
- **Fix Required:**
  - Enable etcd encryption at rest
  - Use external-secrets-operator with Vault/AWS Secrets Manager
  - Rotate tunnel tokens regularly (no automation exists)

#### 3. **Shared OAuth Cookie Secret - MEDIUM RISK**
```typescript
const cookieSecret = new pulumi.Config().requireSecret("oauthCookieSecret");
// Same secret used across all apps
```
- **Problem:** One secret compromise = all OAuth sessions compromised
- **Risk:** Session hijacking across applications
- **Fix Required:** Per-app cookie secrets, auto-generated

#### 4. **No Network Policies - HIGH RISK**
- **Problem:** Any pod can reach any other pod (flat network)
- **Risk:** Lateral movement after initial compromise
- **Impact:** Compromised blog app can access admin database
- **Fix Required:** NetworkPolicy resources (deny-all + explicit allows)

#### 5. **No Pod Security Standards - MEDIUM RISK**
- **Problem:** PSS/PSA not enforced at namespace/cluster level
- **Risk:** Developer could deploy privileged containers (policy warns but doesn't block all vectors)
- **Fix Required:**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  labels:
    pod-security.kubernetes.io/enforce: restricted
```

#### 6. **Image Security - MEDIUM RISK**
- **Problem:** No image scanning, no signature verification, no SBOM
- **Risk:** Supply chain attacks (compromised base images)
- **Fix Required:**
  - Trivy/Grype scanning in CI/CD
  - Sigstore/Cosign image verification
  - Policy to block HIGH/CRITICAL vulnerabilities

#### 7. **No RBAC for Applications - MEDIUM RISK**
```typescript
// Current: Apps likely use default ServiceAccount
spec: {
  containers: [...]  // No serviceAccountName specified
}
```
- **Problem:** Default SA may have broad permissions
- **Risk:** Container escape → excessive Kubernetes API access
- **Fix Required:** Least-privilege ServiceAccounts per app

#### 8. **Cloudflare Sees All Traffic - MEDIUM RISK (Acknowledged)**
- **Problem:** TLS terminates at Cloudflare, they see plaintext
- **Risk:** Privacy, regulatory compliance (GDPR, HIPAA)
- **Mitigation Options:**
  - Client certificates (mTLS)
  - Cloudflare Tunnel with WARP (E2E encryption)
  - For sensitive data: Use Tailscale instead

#### 9. **OAuth Email Validation Bug - LOW RISK**
```typescript
args.oauth.allowedEmails.forEach((email) => {
  oauthProxyContainer.args.push(`--email-domain=${email.split("@")[1]}`);
});
```
- **Problem:** Validates domain, not full email
- **Risk:** `admin@example.com` allowed → `hacker@example.com` also allowed
- **Fix Required:** Use `--authenticated-emails-file` properly

#### 10. **Audit Logging Disabled - MEDIUM RISK**
- **Problem:** No k3s audit logs enabled
- **Risk:** Cannot detect/investigate security incidents
- **Fix Required:** Enable k3s audit logging to file/webhook

#### 11. **No Egress Filtering - LOW RISK**
- **Problem:** Apps can reach any external IP/domain
- **Risk:** Data exfiltration, C2 communication
- **Fix Required:** Network policies for egress, DNS filtering

#### 12. **Tailscale CI/CD Access - MEDIUM RISK**
```yaml
- uses: tailscale/github-action@v2  # Joins Tailnet
```
- **Problem:** GitHub Actions runner gets Tailscale access (broad network reach)
- **Risk:** Compromised GitHub → homelab network access
- **Fix Required:**
  - Tailscale ACLs restricting CI tag to only k8s API
  - Time-limited Tailscale auth keys
  - Consider WireGuard + short-lived certs instead

#### 13. **Long-Lived kubeconfig in GitHub Secrets - MEDIUM RISK**
- **Problem:** No expiry, no rotation, stored indefinitely
- **Risk:** GitHub compromise = permanent cluster access
- **Fix Required:**
  - Short-lived tokens (ServiceAccount with TTL)
  - OIDC federation (GitHub → k8s OIDC provider)
  - Rotate kubeconfig regularly (90 days)

### 🔧 Remediation Priority

**P0 (Deploy Immediately):**
1. Network Policies (deny-all default)
2. etcd encryption at rest
3. Pod Security Standards (restricted)
4. Per-app OAuth secrets

**P1 (This Quarter):**
5. External Secrets Operator
6. Image scanning in CI/CD
7. RBAC ServiceAccounts
8. Audit logging

**P2 (Future):**
9. mTLS between services (service mesh)
10. Egress filtering
11. OIDC federation for CI/CD

---

## 🔧 Ops Engineer Perspective

**Objective:** Reproducible, Portable, Observable

### ✅ Strengths

1. **Infrastructure as Code** - Full reproducibility via Pulumi
2. **Pre-commit/Pre-push Hooks** - Prevents bad deploys
3. **Policy as Code** - Automated compliance checks
4. **Type Safety** - TypeScript catches errors at compile time
5. **Documentation** - ADRs + How-Tos exist

### ❌ Critical Issues

#### 1. **No Observability Stack - CRITICAL**
- **Problem:** No metrics, logs, or traces
- **Impact:** Cannot debug production issues, no visibility into performance
- **Blind Spots:**
  - App crashing? Unknown until user reports
  - Memory leak? Discovered when OOM kills pod
  - Slow responses? No data to investigate
  - Certificate expiring? Find out when site breaks
- **Fix Required:**
```typescript
// Add to core infrastructure
- Prometheus (metrics)
- Loki (logs)
- Grafana (dashboards)
- Alertmanager (notifications)
```

#### 2. **No Alerting - CRITICAL**
- **Problem:** Zero proactive notifications
- **Impact:** All issues discovered reactively (or never)
- **Should Alert On:**
  - Pod crash loops
  - Certificate expiry (< 30 days)
  - Cloudflare Tunnel down
  - Disk space > 80%
  - Memory/CPU > 90%
  - Failed deployments
- **Fix Required:** Alertmanager + PagerDuty/Slack

#### 3. **No Backup Strategy - CRITICAL**
- **Problem:** PersistentVolumes not backed up
- **Impact:** Data loss on disk failure
- **Risk Scenarios:**
  - Blog posts lost
  - User databases gone
  - Configuration data vanished
- **Fix Required:**
  - Velero for PV snapshots
  - Automated daily backups to S3/Backblaze B2
  - Test restores monthly

#### 4. **Single Point of Failure - HIGH RISK**
- **Problem:** One k3s node, no HA
- **Impact:** Hardware failure = total outage
- **Cascading Failures:**
  - Disk failure → all data lost
  - Power supply → all apps down
  - Network card → unreachable
- **Fix Required:**
  - Multi-node k3s cluster (3 nodes minimum)
  - Or: Accept risk for homelab (document it)

#### 5. **No Disaster Recovery Plan - HIGH RISK**
- **Problem:** No documented recovery procedure
- **Questions:**
  - Server dies → what's the recovery time?
  - What needs to be restored in what order?
  - Where are backups stored?
  - Who has access to restore?
- **Fix Required:** DR runbook with tested procedures

#### 6. **Local Pulumi State - MEDIUM RISK**
```bash
pulumi login file://~/.pulumi
```
- **Problem:** State on laptop only, not backed up, not shared
- **Impact:**
  - Laptop failure = lose infrastructure state
  - Can't collaborate (one person has state)
  - Can't deploy from CI/CD
- **Fix Required:**
  - Pulumi Cloud (free tier)
  - Or: S3 backend (`pulumi login s3://bucket`)

#### 7. **No Staging Environment - MEDIUM RISK**
- **Problem:** Changes go directly to production
- **Impact:** Cannot test risky changes safely
- **Fix Required:**
```bash
pulumi stack init staging
pulumi stack init prod
```

#### 8. **No Health Checks on Apps - MEDIUM RISK**
```typescript
// Current: No readinessProbe/livenessProbe
containers: [{
  name: "app",
  image: args.image,
  // Missing: probes
}]
```
- **Problem:** Kubernetes doesn't know if app is healthy
- **Impact:** Traffic routed to broken pods, slow failure detection
- **Fix Required:** Add probes to ExposedWebApp component

#### 9. **No Resource Quotas - LOW RISK**
- **Problem:** Namespace can consume unlimited cluster resources
- **Impact:** One app can starve others
- **Fix Required:**
```typescript
new k8s.core.v1.ResourceQuota("namespace-quota", {
  spec: {
    hard: {
      "requests.cpu": "4",
      "requests.memory": "8Gi",
      "pods": "20"
    }
  }
});
```

#### 10. **No Dependency Scanning - MEDIUM RISK**
- **Problem:** npm packages not scanned for vulnerabilities
- **Impact:** Known CVEs in production
- **Fix Required:**
```bash
npm audit --production
# Fail CI if HIGH/CRITICAL
```

#### 11. **Storage Not Portable - LOW RISK**
```typescript
storageClassName: args.storage.storageClass || "local-path",
```
- **Problem:** `local-path` is node-local, not portable
- **Impact:** Pod rescheduled to different node = data lost
- **Fix Required:**
  - NFS StorageClass (if NAS available)
  - Or: Longhorn for replicated storage

#### 12. **No Certificate Monitoring - MEDIUM RISK**
- **Problem:** Can't detect cert-manager failures
- **Impact:** Cert expires → site down → panic
- **Fix Required:** Prometheus cert-manager exporter + alerts

#### 13. **No GitOps / Drift Detection - LOW RISK**
- **Problem:** Cluster state can drift from Git
- **Impact:** Manual kubectl changes lost, hard to audit
- **Fix Required:**
  - FluxCD/ArgoCD (optional for homelab)
  - Or: Document "no manual changes" policy

#### 14. **No Runbooks - MEDIUM RISK**
- **Problem:** Common issues not documented
- **Questions:**
  - Pod stuck in ImagePullBackOff?
  - Ingress returns 503?
  - Certificate stuck in Pending?
  - Tunnel disconnected?
- **Fix Required:** Troubleshooting guide per component

### 🔧 Remediation Priority

**P0 (Cannot Operate Without):**
1. Observability stack (Prometheus + Loki + Grafana)
2. Alerting (Alertmanager)
3. Backup strategy (Velero)
4. Pulumi Cloud/S3 state backend

**P1 (Operational Maturity):**
5. Disaster recovery runbook
6. Staging environment
7. Health checks in component
8. Certificate monitoring

**P2 (Nice to Have):**
9. Multi-node HA
10. Resource quotas
11. Dependency scanning
12. Portable storage

---

## 👨‍💻 App Developer Perspective

**Objective:** Simple, Fast, Easy to Deploy with Reuse

### ✅ Strengths

1. **Simple API** - One component handles everything
2. **Type Safety** - IDE autocomplete, compile-time errors
3. **Good Examples** - Clear how-to guides
4. **OAuth Just Works** - Don't need to understand sidecars
5. **TLS Automatic** - Don't think about certificates

### ❌ Critical Issues

#### 1. **No Local Development Story - CRITICAL**
- **Problem:** Can't test app locally before deploying
- **Developer Flow:**
  ```bash
  # Write code
  # Deploy to k8s  ← 5-10 min wait
  # Check if it works
  # Make change
  # Redeploy  ← another 5-10 min
  ```
- **Impact:** Painfully slow feedback loop
- **Fix Required:**
```typescript
// Local development mode
if (pulumi.getStack() === "local") {
  // Skip Cloudflare, use localhost
  // Skip OAuth, use dev mode
}
```
Or: Docker Compose for local dev

#### 2. **No Access to Logs - CRITICAL**
- **Problem:** How does developer see app output?
- **Current:** Must SSH to server, run kubectl logs
- **Impact:** Cannot debug production issues
- **Fix Required:**
  - Loki + Grafana (web UI for logs)
  - Or: CLI tool: `homelab logs my-app`

#### 3. **No Shell Access - HIGH**
- **Problem:** How to debug running container?
- **Current:** Must know kubectl exec
- **Impact:** Hard to troubleshoot
- **Fix Required:**
  - Document kubectl exec workflow
  - Or: Web-based terminal (Lens, k9s)

#### 4. **Must Understand Pulumi - MEDIUM**
- **Problem:** Can't just write Dockerfile and deploy
- **Learning Curve:**
  - Install Pulumi
  - Understand stacks
  - Learn TypeScript (if not already)
  - Learn component API
- **Impact:** High barrier to entry
- **Alternatives Considered:**
  - Dockerfile + simple CLI tool
  - GitOps (git push = deploy)
  - Serverless (Cloudflare Workers)

#### 5. **Must Manage Cloudflare Config - MEDIUM**
```typescript
// Every app needs these
pulumi config set cloudflareAccountId ...
pulumi config set cloudflareZoneId ...
pulumi config set --secret cloudflareApiToken ...
```
- **Problem:** Repetitive, error-prone
- **Fix Required:**
  - StackReferences (inherit from infra stack)
  - Or: Shared config file

#### 6. **Slow Deployment Feedback - HIGH**
```
pulumi up
  → DNS propagation (1-5 min)
  → Certificate issuance (2-5 min)
  → Total: 3-10 minutes
```
- **Problem:** Can't iterate quickly
- **Impact:** Frustrating developer experience
- **Fix Required:**
  - Wildcard certs (instant for *.example.com)
  - Or: Reuse existing certs
  - Async deployment (don't wait for DNS)

#### 7. **No Database Story - HIGH**
- **Problem:** How to add Postgres/MySQL/Redis?
- **Current:** Not documented, must figure out
- **Impact:** Every developer reinvents the wheel
- **Fix Required:**
```typescript
new ExposedDatabase("db", {
  type: "postgres",
  version: "16",
  storage: "10Gi",
  backup: true  // Auto-backups
});
```

#### 8. **No Service-to-Service Communication - MEDIUM**
- **Problem:** Frontend app needs to call backend API
- **Current:** Must use internal DNS (`backend.default.svc.cluster.local`)
- **Impact:** Not intuitive, no service discovery abstraction
- **Fix Required:**
```typescript
const backend = new ExposedWebApp("backend", {...});
const frontend = new ExposedWebApp("frontend", {
  env: [{
    name: "BACKEND_URL",
    value: backend.service.metadata.name  // Auto-wired
  }]
});
```

#### 9. **No Rollback - MEDIUM**
```bash
# Bad deploy, site is broken
# How to rollback quickly?
pulumi up  # Redeploy old version? How?
```
- **Problem:** No one-command rollback
- **Fix Required:**
  - Pulumi stack history + rollback
  - Or: Git revert + pulumi up
  - Document the process

#### 10. **No Preview Environments - MEDIUM**
- **Problem:** Can't deploy PR previews
- **Use Case:** Test feature branch before merging
- **Fix Required:**
```yaml
# GitHub Actions
on: pull_request
  pulumi up --stack pr-${{ github.event.number }}
  # Deploy to pr-123.example.com
```

#### 11. **Error Messages Cryptic - LOW**
```
error: resource X failed: ...
[500 lines of stack trace]
```
- **Problem:** Pulumi errors hard to understand
- **Impact:** Developers stuck, need platform team help
- **Fix Required:**
  - Better error handling in components
  - Validation with clear messages

#### 12. **No Cost Visibility - LOW**
- **Problem:** Don't know resource usage/cost
- **Questions:**
  - How much CPU/memory am I using?
  - Am I over-provisioned?
- **Fix Required:**
  - Grafana dashboard per app
  - Cost estimation tool

#### 13. **OAuth Setup Complex - MEDIUM**
```typescript
oauth: {
  provider: "google",
  clientId: "...",  // Where do I get this?
  clientSecret: pulumi.secret("..."),  // How?
  allowedEmails: ["..."]
}
```
- **Problem:** Must understand OAuth, get Google credentials
- **Impact:** Barrier for non-authenticated apps
- **Fix Required:**
  - How-to guide for OAuth setup (exists but could be better)
  - Or: Shared OAuth provider

#### 14. **Component Breaking Changes - LOW**
- **Problem:** Component v2.0 breaks my app
- **Impact:** Must update app code
- **Fix Required:**
  - Semantic versioning (already planned)
  - Migration guides
  - Deprecation warnings

### 🔧 Remediation Priority

**P0 (Developer Velocity):**
1. Log access (Loki + Grafana)
2. Local development mode
3. Database component
4. Faster deployment (wildcard certs)

**P1 (Developer Experience):**
5. Shell access documentation
6. Service-to-service wiring
7. Rollback procedure
8. StackReferences for shared config

**P2 (Advanced Features):**
9. Preview environments
10. Cost visibility
11. Better error messages
12. OAuth how-to improvements

---

## 📊 Summary Matrix

| Perspective | Critical Issues | High Priority | Medium Priority |
|-------------|-----------------|---------------|-----------------|
| **Security** | 4 | 3 | 6 |
| **Ops** | 4 | 4 | 6 |
| **Developer** | 3 | 3 | 7 |
| **TOTAL** | **11** | **10** | **19** |

## 🎯 Top 10 Issues Across All Perspectives

1. **No Observability Stack** (Ops) - Can't operate without it
2. **No Secrets Management** (Security) - High risk, fundamental flaw
3. **No Backup Strategy** (Ops) - Data loss inevitable
4. **No Alerting** (Ops) - Reactive instead of proactive
5. **No Network Policies** (Security) - Lateral movement risk
6. **No Local Development** (Developer) - Slow feedback loop
7. **No Log Access** (Developer) - Can't debug
8. **etcd Not Encrypted** (Security) - Secrets exposed
9. **No Disaster Recovery** (Ops) - Recovery time unknown
10. **No Database Component** (Developer) - Must reinvent

## 🚀 Recommended Next Steps

### Phase 1: Foundation (Week 1-2)
```typescript
// Add to infrastructure/src/core/
- observability.ts  // Prometheus + Loki + Grafana
- network-policies.ts  // Default deny-all
- backup.ts  // Velero setup
```

### Phase 2: Security Hardening (Week 3-4)
```typescript
- external-secrets.ts  // ESO + Vault/SOPS
- pod-security.ts  // PSS enforcement
- rbac.ts  // ServiceAccounts per app
```

### Phase 3: Developer Experience (Week 5-6)
```typescript
// Add to components/
- Database.ts  // Postgres, MySQL, Redis
- Service.ts  // Internal services (no ingress)
// Improve ExposedWebApp
- Add health checks
- Add local dev mode
- Add service references
```

### Phase 4: Operational Maturity (Week 7-8)
- Disaster recovery runbook
- Staging environment
- Certificate monitoring
- Dependency scanning

---

## 📝 Verdict

**Security:** 6/10 - Good foundations, critical gaps in secrets and network isolation
**Ops:** 5/10 - Reproducible infra, zero observability
**Developer:** 7/10 - Simple API, poor debugging experience

**Overall:** Solid start, not production-ready. Needs observability, security hardening, and developer tooling before running anything critical.

**Homelab Grade:** B-
*Good for learning and experimentation. Don't run anything you can't afford to lose.*
