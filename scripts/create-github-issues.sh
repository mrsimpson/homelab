#!/bin/bash
#
# Create GitHub issues from critical assessment gaps
# Run this script locally where gh CLI is available
#
# Usage: ./scripts/create-github-issues.sh

set -e

REPO="mrsimpson/homelab"

echo "Creating GitHub issues for critical gaps..."
echo "Repository: $REPO"
echo ""

# Issue 1: No observability stack
gh issue create \
  --repo "$REPO" \
  --title "No observability stack - cannot debug production issues" \
  --label "ops,critical" \
  --body "**Gap:** No metrics, logs, or traces collection. Zero visibility into application behavior, performance, or errors.

**Why:**
- Cannot debug production issues without SSH + kubectl
- No performance metrics to identify bottlenecks
- Application failures discovered by users, not monitoring
- Certificate expiry, resource exhaustion, crashes are invisible
- Mean time to detection (MTTD) is unacceptably high

**Impact:** Operating blind - all issues discovered reactively or never."

echo "✓ Created: No observability stack"

# Issue 2: No backup strategy
gh issue create \
  --repo "$REPO" \
  --title "No backup strategy - data loss on hardware failure" \
  --label "ops,critical" \
  --body "**Gap:** PersistentVolumes not backed up. No automated backup process. No tested restore procedures.

**Why:**
- Disk failure = permanent data loss (blog posts, databases, user data)
- No point-in-time recovery capability
- Accidental deletion is permanent
- Ransomware/corruption has no rollback path
- Single homelab node = single point of failure for all data

**Impact:** Inevitable data loss. Only question is when, not if."

echo "✓ Created: No backup strategy"

# Issue 3: No alerting
gh issue create \
  --repo "$REPO" \
  --title "No alerting - reactive firefighting only" \
  --label "ops,critical" \
  --body "**Gap:** Zero proactive notifications. No alerts for any failure condition.

**Why:**
- Pod crash loops go unnoticed until user reports
- Certificate expiration discovered when sites break
- Cloudflare Tunnel disconnects are invisible
- Disk space exhaustion causes cascading failures
- High CPU/memory usage has no early warning
- Failed deployments only visible via manual pulumi up check

**Impact:** All incidents discovered by users or manual checks. No proactive operations possible."

echo "✓ Created: No alerting"

# Issue 4: No network policies
gh issue create \
  --repo "$REPO" \
  --title "No network policies - unrestricted lateral movement" \
  --label "security,high" \
  --body "**Gap:** Flat network. Any pod can reach any other pod on any port. No network segmentation.

**Why:**
- Compromised blog app can access admin database directly
- Malicious container can scan entire cluster
- No defense in depth - single breach = full cluster access
- Cannot isolate sensitive workloads
- Violates principle of least privilege

**Impact:** One compromised application = full cluster compromise potential."

echo "✓ Created: No network policies"

# Issue 5: etcd not encrypted
gh issue create \
  --repo "$REPO" \
  --title "etcd not encrypted at rest - secrets readable from disk" \
  --label "security,high" \
  --body "**Gap:** Kubernetes etcd datastore not encrypted at rest. All secrets stored as base64 on disk.

**Why:**
- Disk theft/disposal = all secrets exposed
- Filesystem access = read all OAuth tokens, API keys, passwords
- Backup tapes/snapshots contain plaintext secrets
- ESO mitigates but doesn't eliminate (k8s still stores plaintext)
- Regulatory compliance fails (PCI-DSS, HIPAA require encryption at rest)

**Impact:** Physical or filesystem access compromises all application secrets."

echo "✓ Created: etcd not encrypted"

# Issue 6: No disaster recovery plan
gh issue create \
  --repo "$REPO" \
  --title "No disaster recovery plan - unknown recovery time" \
  --label "ops,high" \
  --body "**Gap:** No documented disaster recovery procedures. No tested recovery process. No RTO/RPO defined.

**Why:**
- Server dies → how long to recover?
- What order to restore components?
- Where are backups stored? How to access?
- Who has credentials to restore?
- No practice runs = no confidence in recovery

**Impact:** Actual disaster would be trial-and-error recovery. Unacceptable downtime."

echo "✓ Created: No disaster recovery plan"

# Issue 7: No local development mode
gh issue create \
  --repo "$REPO" \
  --title "No local development mode - slow iteration cycle" \
  --label "developer-experience,medium" \
  --body "**Gap:** Cannot test infrastructure changes locally. Must deploy to k8s cluster for every test. 5-10 minute feedback loop (DNS propagation + cert issuance).

**Why:**
- Cloudflare Tunnel requires real deployment
- TLS certificates need cert-manager (cluster-only)
- OAuth callback URLs must match production domain
- Cannot iterate quickly on ExposedWebApp changes
- Testing infrastructure requires full k8s deployment

**Impact:** Infrastructure development is slow. Discourages experimentation."

echo "✓ Created: No local development mode"

# Issue 8: No log aggregation
gh issue create \
  --repo "$REPO" \
  --title "No log aggregation - cannot debug without kubectl" \
  --label "developer-experience,high" \
  --body "**Gap:** No centralized log collection. Developers must SSH to server and run kubectl logs to see application output.

**Why:**
- Cannot search logs across multiple pods
- Cannot view logs after pod restart (ephemeral)
- Cannot correlate logs from different services
- No log retention beyond pod lifetime
- Requires cluster access for every debug session

**Impact:** Debugging is painful, requires kubectl knowledge, logs lost on pod restart."

echo "✓ Created: No log aggregation"

# Issue 9: No database component
gh issue create \
  --repo "$REPO" \
  --title "No database component - every app reinvents persistence" \
  --label "developer-experience,medium" \
  --body "**Gap:** No reusable database component (Postgres, MySQL, Redis). Each app must implement own database deployment, backup, credentials, storage.

**Why:**
- Boilerplate repeated across every app needing persistence
- No standardized backup strategy for databases
- No connection pooling abstraction
- No automated credential rotation
- Each developer solves same problems (StatefulSet, PVC, init scripts)

**Impact:** Significant developer friction. Inconsistent database practices across apps."

echo "✓ Created: No database component"

# Issue 10: Local Pulumi state
gh issue create \
  --repo "$REPO" \
  --title "Local Pulumi state - not backed up, not shared" \
  --label "ops,medium" \
  --body "**Gap:** Pulumi state stored locally via \`file://~/.pulumi\`. Not backed up to cloud. Cannot be shared across machines or team members.

**Why:**
- Laptop failure = lose infrastructure state (cannot update/destroy resources)
- Cannot deploy from CI/CD (no shared state)
- Cannot collaborate (state on one machine only)
- No state history/versioning beyond local filesystem
- Accidental deletion of ~/.pulumi is catastrophic

**Impact:** Infrastructure locked to single machine. Collaboration impossible. State loss risk."

echo "✓ Created: Local Pulumi state"

echo ""
echo "✅ All 10 issues created successfully!"
echo ""
echo "View issues at: https://github.com/$REPO/issues"
