# Migrating Pulumi State to Self-Hosted S3

This guide covers migrating from Pulumi Cloud to a self-hosted S3 backend (MinIO or external S3-compatible storage).

**When to migrate:**
- Need 100% self-hosted solution
- Pulumi Cloud outage impacts operations
- Building commercial product (vendor independence)
- Want to learn MinIO operations

**Migration time:** ~1-2 hours (including MinIO setup)

## Prerequisites

- Existing Pulumi Cloud state
- S3-compatible backend ready (MinIO deployed or Backblaze B2 account)
- Access to S3 credentials (access key + secret key)

## Option 1: Migrate to In-Cluster MinIO

### Step 1: Deploy MinIO to Cluster

**Using Pulumi (with current Pulumi Cloud state):**

```typescript
// packages/core/infrastructure/src/minio/index.ts
import * as k8s from "@pulumi/kubernetes";

const minioNamespace = new k8s.core.v1.Namespace("minio", {
  metadata: { name: "minio" }
});

const minio = new k8s.helm.v3.Chart("minio", {
  chart: "minio",
  version: "5.0.15",
  namespace: minioNamespace.metadata.name,
  fetchOpts: {
    repo: "https://charts.min.io/"
  },
  values: {
    mode: "standalone",
    replicas: 1,
    persistence: {
      enabled: true,
      size: "10Gi"
    },
    rootUser: "admin",
    rootPassword: "changeme123", // Change this!
    buckets: [{
      name: "pulumi-state",
      policy: "none",
      purge: false
    }],
    ingress: {
      enabled: true,
      ingressClassName: "nginx",
      hostname: "minio.example.com",
      tls: true,
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-prod"
      }
    }
  }
});

export const minioEndpoint = "https://minio.example.com";
```

**Deploy MinIO:**
```bash
pulumi up  # Still using Pulumi Cloud at this point
```

### Step 2: Configure MinIO Client

```bash
# Install mc (MinIO client)
curl https://dl.min.io/client/mc/release/linux-amd64/mc \
  -o /usr/local/bin/mc
chmod +x /usr/local/bin/mc

# Configure alias
mc alias set homelab-minio https://minio.example.com admin changeme123

# Verify
mc ls homelab-minio
# Should show: pulumi-state bucket
```

### Step 3: Export State from Pulumi Cloud

```bash
# Export all stacks
for stack in dev staging prod; do
  pulumi stack select $stack
  pulumi stack export --file "backup-$stack-$(date +%Y%m%d).json"
done

# Store backups safely
mkdir -p ~/Backups/pulumi-migration
cp backup-*.json ~/Backups/pulumi-migration/
```

### Step 4: Login to MinIO Backend

```bash
# Set MinIO credentials
export AWS_ACCESS_KEY_ID="admin"
export AWS_SECRET_ACCESS_KEY="changeme123"

# Set encryption passphrase (IMPORTANT: Save this!)
export PULUMI_CONFIG_PASSPHRASE="your-strong-passphrase-here"

# Login to MinIO backend
pulumi login s3://pulumi-state?endpoint=https://minio.example.com&region=us-east-1&disableSSL=false&s3ForcePathStyle=true
```

### Step 5: Import State

```bash
# Import each stack
for stack in dev staging prod; do
  pulumi stack init $stack
  pulumi stack import --file "backup-$stack-$(date +%Y%m%d).json"
  pulumi stack select $stack
  pulumi preview  # Verify no changes
done
```

### Step 6: Verify State Works

```bash
# Test deployment
pulumi preview
# Should show: no changes

# Test from fresh clone
cd /tmp
git clone <your-repo> test-clone
cd test-clone/infrastructure
npm install

# Login with same credentials
export AWS_ACCESS_KEY_ID="admin"
export AWS_SECRET_ACCESS_KEY="changeme123"
export PULUMI_CONFIG_PASSPHRASE="your-strong-passphrase"
pulumi login s3://pulumi-state?endpoint=https://minio.example.com&region=us-east-1&s3ForcePathStyle=true

pulumi stack select dev
pulumi preview  # Should work!
```

### Step 7: Update CI/CD

**GitHub Actions:**

```yaml
# .github/workflows/deploy.yml
env:
  PULUMI_BACKEND_URL: s3://pulumi-state?endpoint=https://minio.example.com&region=us-east-1&s3ForcePathStyle=true
  AWS_ACCESS_KEY_ID: ${{ secrets.MINIO_ACCESS_KEY }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.MINIO_SECRET_KEY }}
  PULUMI_CONFIG_PASSPHRASE: ${{ secrets.PULUMI_PASSPHRASE }}
```

**Add secrets to GitHub:**
- `MINIO_ACCESS_KEY`: MinIO access key
- `MINIO_SECRET_KEY`: MinIO secret key
- `PULUMI_PASSPHRASE`: Stack encryption passphrase

### Step 8: Setup External Replication (Critical!)

**MinIO in-cluster is single point of failure. Replicate to NAS/external:**

```bash
# Option A: Mirror to NAS
mc mirror homelab-minio/pulumi-state /mnt/nas/pulumi-backup

# Option B: Mirror to external S3 (Backblaze B2)
mc alias set b2 https://s3.us-west-002.backblazeb2.com $B2_KEY_ID $B2_APP_KEY
mc mirror homelab-minio/pulumi-state b2/pulumi-backup

# Setup cron job for daily backup
crontab -e
# Add: 0 2 * * * mc mirror homelab-minio/pulumi-state /mnt/nas/pulumi-backup
```

### Step 9: Decommission Pulumi Cloud (Optional)

**Only after verifying everything works:**

```bash
# Delete stacks from Pulumi Cloud
pulumi login  # Back to Pulumi Cloud
pulumi stack select dev
pulumi stack rm dev  # Confirm deletion

# Or keep as backup (recommended for 30 days)
```

## Option 2: Migrate to External S3 (Backblaze B2)

**Simpler alternative - no in-cluster infrastructure:**

### Step 1: Setup Backblaze B2

1. Create account: https://www.backblaze.com/b2/sign-up.html
2. Create bucket: `pulumi-state-homelab`
3. Create application key with read/write access

### Step 2: Export State

```bash
pulumi stack export --file state-backup-$(date +%Y%m%d).json
```

### Step 3: Login to B2

```bash
export AWS_ACCESS_KEY_ID="<b2-key-id>"
export AWS_SECRET_ACCESS_KEY="<b2-app-key>"
export PULUMI_CONFIG_PASSPHRASE="your-strong-passphrase"

pulumi login s3://pulumi-state-homelab?endpoint=s3.us-west-002.backblazeb2.com&region=us-west-002
```

### Step 4: Import State

```bash
pulumi stack init dev
pulumi stack import --file state-backup-$(date +%Y%m%d).json
pulumi preview  # Verify
```

### Step 5: Setup Local Backup

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure B2
rclone config
# Follow prompts for Backblaze B2

# Periodic backup to NAS
crontab -e
# Add: 0 3 * * * rclone sync b2:pulumi-state-homelab /mnt/nas/pulumi-backup
```

## Troubleshooting

### Error: "Failed to get state for stack"

**Cause:** Incorrect credentials or endpoint

**Fix:**
```bash
# Verify credentials
echo $AWS_ACCESS_KEY_ID
echo $AWS_SECRET_ACCESS_KEY

# Verify endpoint reachable
curl https://minio.example.com/minio/health/live

# Check bucket exists
mc ls homelab-minio
```

### Error: "Failed to decrypt config"

**Cause:** Wrong PULUMI_CONFIG_PASSPHRASE

**Fix:**
```bash
# Ensure same passphrase used during import
export PULUMI_CONFIG_PASSPHRASE="exact-same-passphrase"

# If lost, can export without secrets, reset passphrase
```

### MinIO Pod Keeps Restarting

**Cause:** PVC not bound or storage issues

**Fix:**
```bash
# Check PVC
kubectl get pvc -n minio

# Check pod logs
kubectl logs -n minio -l app=minio

# Verify storage class exists
kubectl get storageclass
```

### State Corruption / Merge Conflict

**Cause:** Concurrent updates without locking

**Fix:**
```bash
# Restore from backup
pulumi stack import --file backup-dev-YYYYMMDD.json

# Ensure only one person/CI updating at a time
```

## Rollback to Pulumi Cloud

If migration fails:

```bash
# 1. Login back to Pulumi Cloud
pulumi login

# 2. Import from backup
pulumi stack import --file backup-dev-YYYYMMDD.json

# 3. Verify
pulumi preview

# 4. Update CI/CD back to PULUMI_ACCESS_TOKEN
```

## Security Considerations

### Encryption

- **State is encrypted** with PULUMI_CONFIG_PASSPHRASE
- **Passphrase must be strong** (>20 chars, random)
- **Never commit passphrase** to Git
- **Store in password manager** (1Password, Bitwarden)

### Access Control

**MinIO:**
- Change default admin password immediately
- Create service account for Pulumi access only
- Enable access logs

**Backblaze B2:**
- Use application keys (not master key)
- Limit to single bucket access
- Enable bucket versioning

### Backup Strategy

- **3-2-1 Rule**: 3 copies, 2 different media, 1 offsite
- Daily backup to NAS (on-site)
- Weekly backup to external cloud (off-site)
- Test restore monthly

## Performance Comparison

| Backend | State Read | State Write | History |
|---------|------------|-------------|---------|
| Pulumi Cloud | ~200ms | ~500ms | Full |
| MinIO (local) | ~50ms | ~100ms | With versioning |
| Backblaze B2 | ~300ms | ~800ms | With versioning |

MinIO is fastest but requires maintenance. Choose based on priorities.

## Cost Comparison

| Backend | Setup Cost | Monthly Cost | Maintenance |
|---------|------------|--------------|-------------|
| Pulumi Cloud | $0 | $0 (free tier) | 0 hours |
| MinIO | 0 (self-hosted) | ~$2 (power) | 1-2 hours |
| Backblaze B2 | $0 | ~$0.50 | 0 hours |

## References

- [ADR 009: Pulumi Cloud State Backend](../adr/009-pulumi-cloud-state-backend.md)
- [Pulumi S3 Backend Documentation](https://www.pulumi.com/docs/intro/concepts/state/#aws-s3)
- [MinIO Documentation](https://min.io/docs/minio/kubernetes/upstream/)
- [Backblaze B2 + Pulumi Guide](https://www.backblaze.com/blog/pulumi-state-management-with-backblaze-b2/)
