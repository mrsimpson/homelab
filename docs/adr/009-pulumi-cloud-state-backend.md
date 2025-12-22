# ADR 009: Pulumi Cloud for State Backend

**Status:** Accepted
**Date:** 2024-12-22
**Deciders:** Platform Team
**Supersedes:** Local file-based state (`file://~/.pulumi`)

## Context

Pulumi requires a backend to store infrastructure state. State contains:
- Resource IDs and metadata for all managed infrastructure
- Configuration values and secrets (encrypted)
- Stack outputs
- Dependency graph between resources

Currently using local file storage (`pulumi login file://~/.pulumi`), which has critical limitations:
- **Not backed up** - Laptop failure = permanent state loss
- **Single machine** - Cannot deploy from CI/CD or other workstations
- **No collaboration** - State locked to one developer's machine
- **No history** - Cannot view previous state versions
- **Recovery impossible** - Lost state = cannot update/destroy resources

This is **Issue #22** - blocking production use.

## Decision

**Use Pulumi Cloud (SaaS) as the state backend, with documented migration path to self-hosted S3 when needed.**

### Primary Backend: Pulumi Cloud

```bash
pulumi login  # Uses Pulumi Cloud by default
```

State stored in Pulumi's managed service at `https://app.pulumi.com`.

### Future Migration Path: Self-Hosted S3

When 100% self-hosting is required:
```bash
# MinIO (in-cluster) or Backblaze B2 (external)
pulumi login s3://pulumi-state?endpoint=...&region=...
```

## Rationale

### Why Pulumi Cloud (Now)

1. **Zero Setup**
   - `pulumi login` with GitHub/email - done in 30 seconds
   - No infrastructure to deploy
   - No chicken-and-egg problem (MinIO requires cluster, cluster managed by Pulumi)

2. **Free Tier Sufficient**
   - Unlimited stacks for personal use
   - Unlimited state storage
   - Full feature access (history, web UI, encryption)
   - No credit card required

3. **Collaboration Ready**
   - Share state with team members
   - Deploy from CI/CD (GitHub Actions)
   - Deploy from multiple workstations
   - Concurrent access with locking

4. **State Safety**
   - Automatic backups
   - Version history (rollback capability)
   - Geographic redundancy
   - Professional operations team

5. **Web UI**
   - View stack outputs without CLI
   - Inspect resource state
   - Compare state versions
   - Audit log of changes

6. **Low-Friction Migration**
   - Can migrate to self-hosted S3 anytime
   - State export/import is native Pulumi feature
   - 30 minutes of work, well-documented process

### Why Not Alternatives (Now)

**Local File Backend (`file://~/.pulumi`)**
- ❌ Issue #22: Not backed up, single machine, collaboration impossible
- ❌ Blocks production use

**Self-Hosted MinIO (In-Cluster)**
- ❌ Chicken-and-egg: MinIO runs in cluster managed by Pulumi
- ❌ Requires multi-phase bootstrap:
  1. Deploy MinIO with local state
  2. Migrate state to MinIO
  3. Verify and destroy local state
- ❌ More infrastructure to maintain (StatefulSet, backups, monitoring)
- ❌ Cluster failure = state inaccessible (mitigated by external replication)
- ✅ Consider later when:
  - Need 100% self-hosted (philosophical requirement)
  - Comfortable with operational overhead
  - Cluster is stable and replicated

**External S3 (Backblaze B2, AWS S3)**
- ❌ Not self-hosted (violates homelab philosophy slightly)
- ❌ Recurring cost (~$0.50-$5/month depending on provider)
- ✅ Consider as migration target instead of MinIO:
  - Simpler than MinIO (no StatefulSet to maintain)
  - Geographic redundancy built-in
  - Can backup to local NFS/MinIO
  - Avoid chicken-and-egg problem

**Git Backend**
- ❌ Merge conflicts on concurrent updates
- ❌ Large binary blobs in Git history
- ❌ No locking mechanism
- ❌ Not recommended by Pulumi

## Implementation

### Phase 1: Migrate to Pulumi Cloud (Immediate)

**Step 1: Create Pulumi Cloud Account**
```bash
# Option A: GitHub auth
pulumi login

# Option B: Email auth (get token from https://app.pulumi.com)
pulumi login
# Opens browser, sign up with email
```

**Step 2: Export Current State (If Exists)**
```bash
cd infrastructure

# Backup existing state
pulumi stack export --file state-backup-$(date +%Y%m%d).json

# Store backup safely
cp state-backup-*.json ~/Backups/homelab/
```

**Step 3: Login to Pulumi Cloud**
```bash
pulumi login
# Authenticates with Pulumi Cloud
# Creates organization (defaults to GitHub username)
```

**Step 4: Import State to Pulumi Cloud**
```bash
# State automatically syncs to Pulumi Cloud
pulumi preview  # Verify no changes
```

**Step 5: Update Documentation**
- Remove references to `file://~/.pulumi`
- Document Pulumi Cloud login process
- Add migration instructions to howto guides

**Step 6: Configure CI/CD**
```yaml
# .github/workflows/*.yml
env:
  PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

Get access token from: https://app.pulumi.com/account/tokens

### Phase 2: Future Migration to S3 (When Needed)

**Triggers for Migration:**
- Pulumi Cloud outage impacts operations
- Need 100% self-hosted (compliance, philosophy)
- Building commercial product (avoid vendor dependency)
- Want to learn MinIO operations

**Migration Process:**

```bash
# 1. Deploy MinIO or configure Backblaze B2
# (MinIO requires bootstrap - see separate runbook)

# 2. Export state from Pulumi Cloud
pulumi stack export --file state-migration.json

# 3. Login to S3 backend
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export PULUMI_CONFIG_PASSPHRASE="strong-passphrase"
pulumi login s3://pulumi-state?endpoint=minio.example.com&region=us-east-1

# 4. Import state
pulumi stack init production  # Creates stack in new backend
pulumi stack import --file state-migration.json

# 5. Verify
pulumi preview  # Should show "no changes"
pulumi up --yes  # Confirm state matches reality

# 6. Update CI/CD
# Replace PULUMI_ACCESS_TOKEN with:
# - AWS_ACCESS_KEY_ID
# - AWS_SECRET_ACCESS_KEY
# - PULUMI_CONFIG_PASSPHRASE
# - PULUMI_BACKEND_URL

# 7. Test from fresh workstation
# Verify can clone repo, pulumi login s3://..., pulumi preview

# 8. Decommission Pulumi Cloud
# Delete stacks from Pulumi Cloud (optional - can keep as backup)
```

## Consequences

### Positive

1. **Immediate Fix for Issue #22**
   - State backed up professionally
   - Can deploy from anywhere
   - Can collaborate with team

2. **Zero Operational Overhead**
   - No MinIO to maintain
   - No backup scripts to write
   - No monitoring to configure

3. **Better Developer Experience**
   - Web UI for state inspection
   - Stack history and diffs
   - Audit logs

4. **Production Ready**
   - Geographic redundancy
   - Professional SLA
   - Security certifications

5. **Flexibility**
   - Can migrate to S3 later
   - Migration is low-friction (30 min)
   - Not locked in

### Negative

1. **Not Self-Hosted**
   - Dependency on Pulumi SaaS
   - Requires internet for deployments
   - Third-party has access to state metadata

2. **Privacy Consideration**
   - Pulumi can see resource types/names (not values)
   - Stack outputs visible to Pulumi
   - Secrets are encrypted (Pulumi cannot decrypt)
   - Acceptable for homelab; evaluate for sensitive production

3. **Vendor Dependency**
   - Pulumi Cloud outage blocks deployments
   - Service discontinuation would require migration
   - Mitigated by easy export and documented migration path

4. **Free Tier Limits**
   - Currently none for personal use
   - Could change in future
   - State export ensures no lock-in

### Neutral

1. **Internet Required**
   - Cannot deploy offline (same as Cloudflare Tunnel)
   - Not a concern for internet-connected homelab

2. **Account Management**
   - Need Pulumi account
   - Need to secure access token
   - Standard practice for SaaS tools

## Monitoring and Rollback

### How to Monitor Pulumi Cloud Health

- Status page: https://status.pulumi.com
- Twitter: @PulumiCorp
- Can fallback to state export + local file during outages

### Rollback Plan

If Pulumi Cloud becomes unacceptable:
1. Export state: `pulumi stack export --file backup.json`
2. Setup MinIO or Backblaze B2 (1-2 hours)
3. Migrate using import process (30 minutes)
4. Update CI/CD credentials
5. Total downtime: ~2-3 hours

## Alternatives Considered

### Alternative 1: Start with MinIO Immediately

**Rejected because:**
- Chicken-and-egg problem requires complex bootstrap
- More operational overhead from day 1
- No immediate benefit over Pulumi Cloud
- Can add later with minimal friction

**Would choose if:**
- Hard requirement for 100% self-hosted from day 1
- Want to learn MinIO operations specifically
- Pulumi Cloud is blocked (firewall, compliance, etc.)

### Alternative 2: External S3 (Backblaze B2)

**Rejected because:**
- Not self-hosted (similar to Pulumi Cloud)
- Recurring cost ($0.50-$5/month)
- Less convenient than Pulumi Cloud (no web UI)

**Would choose if:**
- Pulumi Cloud hits free tier limits (unlikely)
- Need S3 compatibility for other tools
- Building hybrid deployment (some state in S3, some local)

### Alternative 3: Keep Local File Backend

**Rejected because:**
- This is Issue #22 - explicitly marked as unacceptable
- Blocks collaboration, CI/CD, disaster recovery
- No valid production use case

## Success Criteria

- [x] Can `pulumi preview` and `pulumi up` from any workstation
- [x] Can deploy from CI/CD (GitHub Actions)
- [x] State persists across laptop loss/reinstall
- [x] Multiple developers can collaborate on same stack
- [x] Stack history visible (can compare versions)
- [x] Migration path to S3 documented and tested

## References

- [Issue #22: Local Pulumi state - not backed up, not shared](https://github.com/mrsimpson/homelab/issues/22)
- [Pulumi State and Backends Documentation](https://www.pulumi.com/docs/concepts/state/)
- [Pulumi Cloud Pricing](https://www.pulumi.com/pricing/) - Free for individuals
- [Migrating Between Backends](https://www.pulumi.com/docs/concepts/state/#migrating-between-backends)
- [Self-Hosting Pulumi State](https://www.pulumi.com/docs/concepts/state/#using-a-self-managed-backend)

## Notes

- Pulumi secrets are **always encrypted** regardless of backend (using stack-specific encryption key)
- Pulumi Cloud cannot decrypt secrets (encryption happens client-side)
- State contains resource IDs and metadata, not sensitive runtime data (passwords, keys)
- For maximum paranoia: Can use client-side encryption before storing in any backend
- Pulumi Cloud free tier is genuinely unlimited for personal use (as of 2024)
- Migration to S3 is well-tested and documented by Pulumi (many enterprise customers do this)
