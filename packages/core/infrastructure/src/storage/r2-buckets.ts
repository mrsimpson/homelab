import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const longhornConfig = new pulumi.Config("longhorn"); // Namespaced config
const stack = pulumi.getStack();
const cloudflareAccountId = config.require("cloudflareAccountId");

export const bucketName = `homelab-${stack}-backups`;
export const r2Endpoint = `https://${cloudflareAccountId}.eu.r2.cloudflarestorage.com`;
export const backupTargetRoot = `s3://${bucketName}@auto/`;

/**
 * Check if backup credentials are configured
 */
export function hasBackupCredentials(): boolean {
  try {
    const accessKey = longhornConfig.get("backupAccessKeyId");
    const secretKey = longhornConfig.get("backupSecretAccessKey");
    const hasKeys = !!(accessKey && secretKey);
    pulumi.log.info(
      `Checking credentials: accessKey=${!!accessKey}, secretKey=${!!secretKey}, result=${hasKeys}`
    );
    return hasKeys;
  } catch (error) {
    pulumi.log.info(`Credential check error: ${error}`);
    return false;
  }
}

/**
 * Get credentials for use in backup secret creation
 */
export function getBackupCredentials(): {
  accessKeyId: pulumi.Output<string>;
  secretAccessKey: pulumi.Output<string>;
} {
  const accessKeyId =
    longhornConfig.getSecret("backupAccessKeyId") || longhornConfig.get("backupAccessKeyId");
  const secretAccessKey =
    longhornConfig.getSecret("backupSecretAccessKey") ||
    longhornConfig.get("backupSecretAccessKey");

  return {
    accessKeyId: pulumi.output(accessKeyId || ""),
    secretAccessKey: pulumi.output(secretAccessKey || ""),
  };
}

/**
 * Log R2 bucket configuration status
 */
export function logR2Status(): void {
  const hasCredentials = hasBackupCredentials();

  if (!hasCredentials) {
    pulumi.log.info(`
⚠️ LONGHORN BACKUP - R2 CREDENTIALS NEEDED

Bucket: ${bucketName} (create manually)
Endpoint: ${r2Endpoint}
Account: ${cloudflareAccountId}

Configure credentials:
  pulumi config set longhorn:backupAccessKeyId <ACCESS_KEY_ID> --secret
  pulumi config set longhorn:backupSecretAccessKey <SECRET_ACCESS_KEY> --secret
  pulumi up
    `);
  } else {
    pulumi.log.info(`
✅ LONGHORN BACKUP - R2 CONFIGURED

Bucket: ${bucketName}
Endpoint: ${r2Endpoint}
Account: ${cloudflareAccountId}
Status: Ready for automatic backups

Storage Classes:
• longhorn-persistent → Automatic daily R2 backups
• longhorn-uncritical → No backups

Schedule: Daily at 2 AM, retains 7 days of backups
    `);
  }
}
