/**
 * @mrsimpson/homelab-core-infrastructure/storage
 *
 * Persistent storage infrastructure for homelab:
 * - Longhorn distributed storage system with Cloudflare R2 backup
 * - Intent-based storage classes (persistent/uncritical)
 * - Parent bucket provisioning with subfolder organization
 * - Automatic backup scheduling via label selectors
 *
 * Architecture:
 * - R2 parent bucket: homelab-{stack}-backups (Pulumi-managed)
 * - Subfolders: {namespace}-{pvc-name}/ (Longhorn-managed)
 * - Storage classes encode backup behavior automatically
 * - Daily backup jobs with 7-day retention
 */

export * from "./longhorn";
export * from "./storage-classes";
export * from "./validation";
export * from "./backup";
export * from "./r2-buckets";
