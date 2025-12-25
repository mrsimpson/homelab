# Issue Status Update - Post Review Changes

Based on recent changes (monorepo refactor, PSS implementation, etcd encryption), here's the status of existing GitHub issues:

## ✅ Issues to Close

### #17 - etcd not encrypted at rest - secrets readable from disk
**Status:** ✅ RESOLVED

**Resolution:**
- Added `--secrets-encryption` flag to k3s setup guide (docs/howto/setup-cluster.md:23)
- All Kubernetes secrets now encrypted at rest in etcd using AES-CBC
- Includes verification steps and migration guide for existing installations

**Commits:**
- b32c268 - Add --secrets-encryption to k3s setup guide
- 7925536 - Update review status: etcd encryption now resolved

**To close this issue, run:**
```bash
gh issue close 17 --comment "✅ RESOLVED by adding --secrets-encryption to k3s setup guide.

All Kubernetes secrets (Cloudflare Tunnel credentials, OAuth secrets, TLS keys) are now encrypted at rest in etcd using AES-CBC.

See:
- docs/howto/setup-cluster.md (Step 1)
- Commit: b32c268
- https://docs.k3s.io/security/secrets-encryption"
```

---

## ❌ Issues Still Valid (No Changes)

### #13 - No observability stack - cannot debug production issues
**Status:** Still valid (P0)
**Effort:** 3-5 days

### #14 - No backup strategy - data loss on hardware failure
**Status:** Still valid (P0)
**Effort:** 2-3 days

### #15 - No alerting - reactive firefighting only
**Status:** Still valid (P1)
**Effort:** 1-2 days

### #16 - No network policies - unrestricted lateral movement
**Status:** Still valid (P0 - Critical Security Gap)
**Effort:** 1-2 days

### #18 - No disaster recovery plan - unknown recovery time
**Status:** Still valid (P1)
**Effort:** Documentation + testing

### #19 - No local development mode - slow iteration cycle
**Status:** Still valid (P0 - Developer Experience)
**Effort:** 2-3 days

### #20 - No log aggregation - cannot debug without kubectl
**Status:** Still valid (P1 - depends on observability stack)
**Effort:** Included in observability

### #21 - No database component - every app reinvents persistence
**Status:** Still valid (P1)
**Effort:** 3-4 days

### #22 - Local Pulumi state - not backed up, not shared
**Status:** Partially addressed by ADR 009, implementation pending
**Effort:** 1-2 hours (migration to Pulumi Cloud)

---

## 📊 Summary

**Resolved:** 1 issue (#17)
**Still Open:** 8 issues
**Priority Breakdown:**
- P0 (Critical): 4 issues (#13, #14, #16, #19)
- P1 (This Quarter): 4 issues (#15, #18, #20, #21, #22)

**Recommended Action:** Close #17 and focus next on P0 issues in this order:
1. #16 - Network policies (security gap)
2. #13 - Observability stack (operational necessity)
3. #14 - Backup strategy (data protection)
4. #19 - Local dev mode (developer velocity)
