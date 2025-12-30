import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { getBackupCredentials, backupTargetRoot, hasBackupCredentials } from "./r2-buckets";

/**
 * Longhorn Backup Configuration
 *
 * Simplified backup configuration using parent R2 bucket model:
 * - R2 bucket created manually in Cloudflare
 * - Longhorn manages subfolders per PVC
 * - Credentials from scoped R2 API tokens
 * - Daily backup jobs with label matching
 */

const config = new pulumi.Config();

export interface BackupConfig {
  accountId: string;
  accessKeyId: pulumi.Output<string>;
  secretAccessKey: pulumi.Output<string>;
  s3Endpoint: string;
  hasCredentials: boolean;
  backupTarget: string;
}

/**
 * Gets backup configuration for parent bucket model
 */
export function getBackupConfig(): BackupConfig {
  const accountId = config.require("cloudflareAccountId");
  const s3Endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  
  const hasCredentials = hasBackupCredentials();
  let creds = { 
    accessKeyId: pulumi.secret(""), 
    secretAccessKey: pulumi.secret("") 
  };
  
  if (hasCredentials) {
    creds = getBackupCredentials();
  }

  return {
    accountId,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    s3Endpoint,
    hasCredentials,
    backupTarget: String(backupTargetRoot),
  };
}

/**
 * Creates Longhorn backup credentials secret
 */
export function createBackupSecret(
  namespace: string,
  backupConfig: BackupConfig
): k8s.core.v1.Secret {
  return new k8s.core.v1.Secret("longhorn-backup-secret", {
    metadata: {
      name: "longhorn-backup-secret",
      namespace: namespace,
      labels: {
        "app.kubernetes.io/name": "longhorn",
        "app.kubernetes.io/component": "backup",
      },
    },
    stringData: {
      AWS_ACCESS_KEY_ID: backupConfig.accessKeyId,
      AWS_SECRET_ACCESS_KEY: backupConfig.secretAccessKey,
      AWS_ENDPOINTS: backupConfig.s3Endpoint,
      VIRTUAL_HOSTED_STYLE: "false",
    },
  });
}

/**
 * Creates a daily backup recurring job
 * 
 * Only create this if backup credentials are available
 */
export function createDailyBackupJob(
  namespace: string
): k8s.apiextensions.CustomResource | undefined {
  if (!hasBackupCredentials()) {
    pulumi.log.info("Skipping backup job creation - R2 credentials not configured");
    return undefined;
  }

  pulumi.log.info("Creating daily backup job - R2 credentials configured ✓");

  return new k8s.apiextensions.CustomResource("backup-job-daily", {
    apiVersion: "longhorn.io/v1beta2",
    kind: "RecurringJob",
    metadata: {
      name: "backup-daily",
      namespace: namespace,
      labels: {
        "app.kubernetes.io/name": "longhorn",
        "app.kubernetes.io/component": "backup-job",
      },
    },
    spec: {
      name: "backup-daily",
      cron: "0 2 * * *", // 2 AM daily
      task: "backup",
      retain: 7,
      concurrency: 1,
      groups: ["default"],
      labels: {
        "backup-policy": "daily",
      },
    },
  });
}

/**
 * Returns configuration instructions for backup setup
 */
export function getBackupInstructions(): string {
  const cfg = getBackupConfig();

  if (!cfg.hasCredentials) {
    return `
⚠️ LONGHORN BACKUP - R2 CREDENTIALS NEEDED

Account: ${cfg.accountId}
S3 Endpoint: ${cfg.s3Endpoint}
Backup Target: ${cfg.backupTarget}

Configure credentials and deploy:
  pulumi config set longhorn:backupAccessKeyId <ACCESS_KEY> --secret
  pulumi config set longhorn:backupSecretAccessKey <SECRET_KEY> --secret
  pulumi up
`;
  }

  return `
✅ LONGHORN BACKUP CONFIGURED

Account: ${cfg.accountId}  
S3 Endpoint: ${cfg.s3Endpoint}
Backup Target: ${cfg.backupTarget}
Status: Ready for automatic backups

Storage Classes:
• longhorn-persistent  → Automatic daily R2 backups
• longhorn-uncritical  → No backups

Usage:
• Create PVC with storageClassName: longhorn-persistent
• Backups run automatically at 2 AM daily
• View Longhorn UI: kubectl port-forward -n longhorn-system svc/longhorn-frontend 8080:80

Schedule: Daily at 2 AM, retains 7 days of backups
`;
}

/**
 * Logs backup configuration status
 */
export function logBackupStatus(): void {
  const instructions = getBackupInstructions();
  pulumi.log.info(instructions);
}
