# GitHub Issues from Critical Review

Copy these into GitHub Issues. Each section is one issue.

---

## Issue 1: No observability stack - cannot debug production issues

**Labels:** ops, critical

**Description:**

**Gap:** No metrics, logs, or traces collection. Zero visibility into application behavior, performance, or errors.

**Why:**
- Cannot debug production issues without SSH + kubectl
- No performance metrics to identify bottlenecks
- Application failures discovered by users, not monitoring
- Certificate expiry, resource exhaustion, crashes are invisible
- Mean time to detection (MTTD) is unacceptably high

**Impact:** Operating blind - all issues discovered reactively or never.

---

## Issue 2: No backup strategy - data loss on hardware failure

**Labels:** ops, critical

**Description:**

**Gap:** PersistentVolumes not backed up. No automated backup process. No tested restore procedures.

**Why:**
- Disk failure = permanent data loss (blog posts, databases, user data)
- No point-in-time recovery capability
- Accidental deletion is permanent
- Ransomware/corruption has no rollback path
- Single homelab node = single point of failure for all data

**Impact:** Inevitable data loss. Only question is when, not if.

---

## Issue 3: No alerting - reactive firefighting only

**Labels:** ops, critical

**Description:**

**Gap:** Zero proactive notifications. No alerts for any failure condition.

**Why:**
- Pod crash loops go unnoticed until user reports
- Certificate expiration discovered when sites break
- Cloudflare Tunnel disconnects are invisible
- Disk space exhaustion causes cascading failures
- High CPU/memory usage has no early warning
- Failed deployments only visible via manual pulumi up check

**Impact:** All incidents discovered by users or manual checks. No proactive operations possible.

---

## Issue 4: No network policies - unrestricted lateral movement

**Labels:** security, high

**Description:**

**Gap:** Flat network. Any pod can reach any other pod on any port. No network segmentation.

**Why:**
- Compromised blog app can access admin database directly
- Malicious container can scan entire cluster
- No defense in depth - single breach = full cluster access
- Cannot isolate sensitive workloads
- Violates principle of least privilege

**Impact:** One compromised application = full cluster compromise potential.

---

## Issue 5: etcd not encrypted at rest - secrets readable from disk

**Labels:** security, high

**Description:**

**Gap:** Kubernetes etcd datastore not encrypted at rest. All secrets stored as base64 on disk.

**Why:**
- Disk theft/disposal = all secrets exposed
- Filesystem access = read all OAuth tokens, API keys, passwords
- Backup tapes/snapshots contain plaintext secrets
- ESO mitigates but doesn't eliminate (k8s still stores plaintext)
- Regulatory compliance fails (PCI-DSS, HIPAA require encryption at rest)

**Impact:** Physical or filesystem access compromises all application secrets.

---

## Issue 6: No disaster recovery plan - unknown recovery time

**Labels:** ops, high

**Description:**

**Gap:** No documented disaster recovery procedures. No tested recovery process. No RTO/RPO defined.

**Why:**
- Server dies → how long to recover?
- What order to restore components?
- Where are backups stored? How to access?
- Who has credentials to restore?
- No practice runs = no confidence in recovery

**Impact:** Actual disaster would be trial-and-error recovery. Unacceptable downtime.

---

## Issue 7: No local development mode - slow iteration cycle

**Labels:** developer-experience, medium

**Description:**

**Gap:** Cannot test infrastructure changes locally. Must deploy to k8s cluster for every test. 5-10 minute feedback loop (DNS propagation + cert issuance).

**Why:**
- Cloudflare Tunnel requires real deployment
- TLS certificates need cert-manager (cluster-only)
- OAuth callback URLs must match production domain
- Cannot iterate quickly on ExposedWebApp changes
- Testing infrastructure requires full k8s deployment

**Impact:** Infrastructure development is slow. Discourages experimentation.

---

## Issue 8: No log aggregation - cannot debug without kubectl

**Labels:** developer-experience, high

**Description:**

**Gap:** No centralized log collection. Developers must SSH to server and run kubectl logs to see application output.

**Why:**
- Cannot search logs across multiple pods
- Cannot view logs after pod restart (ephemeral)
- Cannot correlate logs from different services
- No log retention beyond pod lifetime
- Requires cluster access for every debug session

**Impact:** Debugging is painful, requires kubectl knowledge, logs lost on pod restart.

---

## Issue 9: No database component - every app reinvents persistence

**Labels:** developer-experience, medium

**Description:**

**Gap:** No reusable database component (Postgres, MySQL, Redis). Each app must implement own database deployment, backup, credentials, storage.

**Why:**
- Boilerplate repeated across every app needing persistence
- No standardized backup strategy for databases
- No connection pooling abstraction
- No automated credential rotation
- Each developer solves same problems (StatefulSet, PVC, init scripts)

**Impact:** Significant developer friction. Inconsistent database practices across apps.

---

## Issue 10: Local Pulumi state - not backed up, not shared

**Labels:** ops, medium

**Description:**

**Gap:** Pulumi state stored locally via `file://~/.pulumi`. Not backed up to cloud. Cannot be shared across machines or team members.

**Why:**
- Laptop failure = lose infrastructure state (cannot update/destroy resources)
- Cannot deploy from CI/CD (no shared state)
- Cannot collaborate (state on one machine only)
- No state history/versioning beyond local filesystem
- Accidental deletion of `~/.pulumi` is catastrophic

**Impact:** Infrastructure locked to single machine. Collaboration impossible. State loss risk.

---

## How to Create These Issues

1. Go to https://github.com/mrsimpson/homelab/issues/new
2. Copy title and description from each section above
3. Add appropriate labels (listed at top of each issue)
4. Create issue

Or use GitHub CLI if available:
```bash
gh issue create --title "..." --body "..." --label "ops,critical"
```
