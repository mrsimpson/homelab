# How to Set Up Backup for Persistent Storage

**Status:** Ready for Configuration  
**Backup Solution:** Longhorn + S3-compatible Cloud Storage  
**Providers Supported:** AWS S3, Backblaze B2, MinIO  

This guide covers setting up automated backup for your Longhorn persistent storage to cheap cloud storage providers.

## Overview

Longhorn provides automatic backup capabilities to S3-compatible storage:
- **Automated snapshots** on schedule (daily, weekly)
- **Cloud storage** to AWS S3, Backblaze B2, or any S3-compatible provider  
- **Point-in-time recovery** from any backup
- **Cross-region replication** for disaster recovery
- **Compression and deduplication** to minimize storage costs

## Current Status

✅ **Longhorn deployed** with backup infrastructure ready  
✅ **Backup target configured** (empty - needs cloud storage)  
✅ **Backup secret** configured (`longhorn-backup-secret`)  
⚠️  **No backup destination** configured yet  

```bash
# Check current backup status
kubectl get backuptarget -n longhorn-system
kubectl get settings -n longhorn-system | grep backup
```

## Configuration Options

### Option 1: Cloudflare R2 (Recommended - Best for Homelabs)

**Cost:** $15/TB/month, **zero egress fees**, free 10GB tier  
**Setup time:** 10 minutes  
**Advantages:** No bandwidth charges, global CDN, integrated with Cloudflare ecosystem

#### Step 1: Create Cloudflare R2 Bucket

1. **Login to Cloudflare Dashboard** → **R2 Object Storage**
2. **Create bucket:**
   - Name: `my-homelab-backup` (globally unique)
   - Location: Choose closest to you (or "Automatic")
3. **Create R2 API Token:**
   - Go to **R2 → Manage R2 API Tokens** → **Create API Token**
   - Token name: `longhorn-backup`
   - Permissions: **Object Read & Write**
   - Specify bucket: Select your bucket
   - **Copy** the `Access Key ID` and `Secret Access Key`
4. **Get S3-compatible credentials:**
   - In R2 dashboard, you'll see **two types** of credentials:
   - ✅ **S3 credentials** (Access Key ID + Secret) - for storage operations
   - ⚠️ **API Token** - for bucket management (not needed for Longhorn)

#### Step 2: Configure Backup Credentials

**Using External Secrets (Recommended - More Secure):**

```bash
# Add credentials to Pulumi ESC (encrypted, managed by ESO)
pulumi config set --secret longhorn/backup/accessKeyId "YOUR_R2_ACCESS_KEY"
pulumi config set --secret longhorn/backup/secretAccessKey "YOUR_R2_SECRET_KEY"

# Configure backup in code (see src/index.ts):
export const backupConfig = {
  provider: "cloudflare-r2",
  bucket: "my-homelab-backup", 
  region: "YOUR_CLOUDFLARE_ACCOUNT_ID", // Account ID
};

# Deploy
pulumi up
```

**Alternative: Direct Pulumi Config (Less Secure):**

```bash  
pulumi config set longhorn:backupProvider cloudflare-r2
pulumi config set longhorn:backupBucket my-homelab-backup
pulumi config set longhorn:backupAccessKeyId YOUR_R2_ACCESS_KEY --secret
pulumi config set longhorn:backupSecretAccessKey YOUR_R2_SECRET_KEY --secret
# Note: Uses existing cloudflareAccountId automatically
pulumi up
```

### Option 2: Backblaze B2 (Cheapest)

**Cost:** ~$5/TB/month, no egress fees for downloads  
**Setup time:** 10 minutes  

#### Step 1: Create Backblaze B2 Bucket

1. **Sign up** at [backblaze.com](https://www.backblaze.com/b2/cloud-storage.html) (free tier: 10GB)
2. **Create bucket:**
   - Name: `my-homelab-backup` (globally unique)
   - Privacy: Private
   - Region: Choose closest to you
3. **Create Application Key:**
   - Go to App Keys → Create Key
   - Key Name: `longhorn-backup`
   - Bucket: Select your bucket
   - Permissions: Read and Write
   - **Copy** the `keyID` and `applicationKey` (shown once!)

#### Step 2: Configure Pulumi

```bash
# Set Cloudflare R2 configuration  
pulumi config set longhorn:backupProvider cloudflare-r2
pulumi config set longhorn:backupBucket my-homelab-backup

# Use S3-compatible credentials (NOT Cloudflare API token)
pulumi config set longhorn:backupAccessKeyId YOUR_R2_S3_ACCESS_KEY_ID --secret
pulumi config set longhorn:backupSecretAccessKey YOUR_R2_S3_SECRET_ACCESS_KEY --secret

# Optional: Override endpoint for regional R2 (defaults to global)
# pulumi config set longhorn:backupEndpoint https://eu.r2.cloudflarestorage.com

# Deploy backup configuration
pulumi up
```

### Option 2: AWS S3

**Cost:** ~$23/TB/month standard, $1/TB/month Glacier Deep Archive  
**Setup time:** 15 minutes  

#### Step 1: Create S3 Bucket

```bash
# Create bucket (replace with your bucket name)
aws s3 mb s3://my-homelab-backup-12345

# Enable versioning for point-in-time recovery
aws s3api put-bucket-versioning \
  --bucket my-homelab-backup-12345 \
  --versioning-configuration Status=Enabled
```

#### Step 2: Create IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-homelab-backup-12345",
        "arn:aws:s3:::my-homelab-backup-12345/*"
      ]
    }
  ]
}
```

#### Step 3: Configure Pulumi

```bash
# Set AWS S3 configuration
pulumi config set longhorn:backupProvider aws-s3
pulumi config set longhorn:backupBucket my-homelab-backup-12345
pulumi config set longhorn:backupRegion us-east-1  # your S3 region
pulumi config set longhorn:backupAccessKeyId YOUR_AWS_ACCESS_KEY --secret
pulumi config set longhorn:backupSecretAccessKey YOUR_AWS_SECRET_KEY --secret

# Deploy backup configuration
pulumi up
```

### Option 3: Self-Hosted MinIO

**Cost:** Your hosting costs  
**Setup time:** 30 minutes  

If you have another server or NAS, you can run MinIO for S3-compatible storage:

```bash
# Run MinIO server (example)
docker run -d \
  --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=your-secure-password \
  -v /data:/data \
  minio/minio server /data --console-address ":9001"

# Configure Pulumi
pulumi config set longhorn:backupProvider s3-compatible
pulumi config set longhorn:backupBucket homelab-backup
pulumi config set longhorn:backupEndpoint http://your-minio-server:9000
pulumi config set longhorn:backupAccessKeyId minioadmin --secret
pulumi config set longhorn:backupSecretAccessKey your-secure-password --secret
```

## Backup Policies

Once backup storage is configured, Longhorn automatically creates backup jobs:

### Daily Backups
- **Schedule:** 2 AM daily
- **Retention:** 7 days
- **Target volumes:** All with label `backup-policy: daily`

### Weekly Backups  
- **Schedule:** 3 AM Sundays
- **Retention:** 4 weeks
- **Target volumes:** All with label `backup-policy: weekly`

## Enabling Backup for Volumes

### For New Applications

Add backup labels when creating storage:

```typescript
const app = homelab.createExposedWebApp("my-database", {
  image: "postgres:15",
  domain: "db.example.com", 
  port: 5432,
  storage: {
    size: "20Gi",
    storageClass: "longhorn-database", // Critical data with Retain policy
    mountPath: "/var/lib/postgresql/data",
  },
  // Add backup labels
  podLabels: {
    "backup-policy": "daily", // Enable daily backups
  },
});
```

### For Existing Volumes

Label existing PVCs to enable backup:

```bash
# Enable daily backup for a volume
kubectl label pvc my-database-storage backup-policy=daily

# Enable weekly backup for a volume  
kubectl label pvc my-archive-storage backup-policy=weekly

# List labeled volumes
kubectl get pvc -l backup-policy
```

## Managing Backups

### Longhorn UI

Access the Longhorn web interface:

```bash
# Port-forward to Longhorn UI
kubectl port-forward -n longhorn-system service/longhorn-frontend 8080:80

# Open in browser
open http://localhost:8080
```

In the UI you can:
- View all backups and snapshots
- Create manual backups
- Restore from any backup point
- Monitor backup job status

### Manual Backup

Create a one-time backup via CLI:

```bash
# Create manual snapshot
kubectl apply -f - <<EOF
apiVersion: longhorn.io/v1beta2
kind: Snapshot
metadata:
  name: manual-backup-$(date +%Y%m%d-%H%M)
  namespace: longhorn-system
spec:
  volume: pvc-abc123def456  # Replace with actual volume name
  createSnapshot: true
EOF
```

### Restore from Backup

1. **Via Longhorn UI:** Volume → Backup tab → Restore
2. **Via CLI:** Create new PVC from backup

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: restored-data
  namespace: my-namespace
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: longhorn-database
  resources:
    requests:
      storage: 20Gi
  # Reference backup to restore from
  dataSource:
    apiGroup: longhorn.io
    kind: Volume
    name: backup-name-from-ui
EOF
```

## Monitoring and Alerts

### Check Backup Status

```bash
# View backup targets
kubectl get backuptarget -n longhorn-system

# View recurring jobs
kubectl get recurringjob -n longhorn-system

# Check recent backups
kubectl get backup -n longhorn-system --sort-by=.metadata.creationTimestamp

# View backup events
kubectl get events -n longhorn-system | grep -i backup
```

### Common Issues

#### Backup Target Not Available

```bash
# Check backup secret exists
kubectl get secret longhorn-backup-secret -n longhorn-system

# Check backup target URL
kubectl get setting backup-target -n longhorn-system -o yaml

# Test connectivity
kubectl exec -n longhorn-system deployment/longhorn-manager -- \
  curl -f "YOUR_S3_ENDPOINT"
```

#### Backup Jobs Not Running

```bash
# Check recurring job status
kubectl describe recurringjob backup-daily -n longhorn-system

# Check if volumes are labeled for backup
kubectl get pvc -A --show-labels | grep backup-policy

# Manually trigger backup job
kubectl patch recurringjob backup-daily -n longhorn-system \
  --type='merge' -p='{"spec":{"cron":"* * * * *"}}'  # Run every minute for testing
```

## Costs and Optimization

### Cloudflare R2 (Recommended for Homelabs)
- **$15/TB/month** for storage
- **Zero egress fees** (unlimited downloads)
- **Free tier:** 10GB storage, 10M requests/month
- **Global CDN:** Fast access worldwide
- **Best for:** Homelabs already using Cloudflare

### Backblaze B2 (Cheapest)
- **$5/TB/month** for storage
- **No egress fees** for downloads
- **Free tier:** 10GB storage, 1GB/day download
- **Lifecycle rules:** Auto-delete old backups

### AWS S3 Options
- **Standard:** $23/TB/month (frequent access)
- **IA:** $12.5/TB/month (infrequent access, 30+ days)  
- **Glacier:** $4/TB/month (archive, hours for retrieval)
- **Glacier Deep:** $1/TB/month (long-term, 12h retrieval)

### Optimization Tips

1. **Use compression:** Longhorn compresses by default (lz4)
2. **Set retention policies:** Don't keep more backups than needed
3. **Label volumes selectively:** Only backup critical data daily
4. **Use lifecycle rules:** Auto-transition old backups to cheaper tiers

## Security Considerations

### Backup Encryption
- **In transit:** HTTPS/TLS to cloud storage
- **At rest:** Provider encryption (enabled by default)
- **Client-side:** Longhorn supports backup encryption (advanced)

### Access Control
- **Minimal permissions:** Only read/write to specific bucket
- **Rotate keys:** Regularly rotate backup credentials
- **Network security:** Restrict backup traffic if needed

## Disaster Recovery

### Full Recovery Procedure

1. **Deploy fresh Longhorn cluster**
2. **Configure same backup target**
3. **Restore volumes from backup:**
   - Identify backup names from UI/CLI
   - Create PVCs with dataSource pointing to backups
   - Deploy applications using restored PVCs

### Testing Recovery

Regularly test your backup/restore process:

```bash
# 1. Create test data
kubectl exec -it my-pod -- bash -c "echo 'test data' > /data/test.txt"

# 2. Create backup
# (via UI or wait for scheduled backup)

# 3. Simulate disaster
kubectl delete pvc my-data-pvc

# 4. Restore from backup
kubectl apply -f restore-pvc.yaml

# 5. Verify data
kubectl exec -it my-pod -- cat /data/test.txt
```

## Next Steps

1. **Configure backup storage** using one of the options above
2. **Label your volumes** for appropriate backup policies  
3. **Test restore procedure** with non-critical data
4. **Set up monitoring** for backup job success/failure
5. **Document your recovery procedures** for your specific applications

---

**Need Help?**
- Check Longhorn backup status: `kubectl get backuptarget -n longhorn-system`
- View Longhorn UI: `kubectl port-forward -n longhorn-system svc/longhorn-frontend 8080:80`
- Check logs: `kubectl logs -n longhorn-system deployment/longhorn-manager`