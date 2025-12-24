# @mrsimpson/homelab-config

Centralized Pulumi configuration for the homelab infrastructure.

## What Goes Here

- **Centralized config loading** - Single source of truth for all environment settings
- **Type-safe configuration** - Exports fully typed config object
- **No secrets in code** - Uses Pulumi secrets management

## Usage

```typescript
import { homelabConfig } from "@mrsimpson/homelab-config";

// Access configuration
console.log(homelabConfig.domain);
console.log(homelabConfig.cloudflare.zoneId);
console.log(homelabConfig.cluster.name);
```

## Configuration Variables

Set via: `pulumi config set <key> <value>`

**Required:**
- `domain` - Your domain (e.g., example.com)
- `cloudflareAccountId` - Cloudflare account ID
- `cloudflareZoneId` - Cloudflare DNS zone ID
- `email` - Email for Let's Encrypt
- `pulumiOrganization` - Pulumi organization
- `pulumiAccessToken` - Pulumi API token (secret)

**Optional:**
- `nfsServer` - NFS server IP for persistent storage
- `clusterName` - Kubernetes cluster name (default: homelab)
- `namespace` - Default namespace (default: default)

## No Dependencies

This package has no internal dependencies - just Pulumi config loading.
