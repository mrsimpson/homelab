# Pulumi Config Backup with SOPS/AGE

Encrypt and backup your entire Pulumi configuration (stack config + ESC environments + secrets) using SOPS and AGE asymmetric encryption.

## Files

- `setup-encryption.sh` - Generate encryption keys (one-time)
- `export-config.sh` - Export and encrypt current config
- `restore-config.sh` - Decrypt and restore to a stack
- `.sops.age` - Private AGE key (keep secure, in .gitignore)
- `.sops.yaml` - SOPS configuration
- `pulumi-config.enc.yaml` - Encrypted backup (safe to commit)
- `.gitignore` - Prevents accidental key commits

## Key Storage & Backup

**The `.sops.age` file is your private key - keep it secure!**

The key is in `.gitignore` and will NOT be committed. Store it securely:

```bash
# After setup, back up the key to a secure location
mkdir -p ~/.sops-backup
cp .sops.age ~/.sops-backup/pulumi-homelab.age
chmod 600 ~/.sops-backup/pulumi-homelab.age
```

Store the backup in a password manager, vault, or secure offline location.

**Safe to commit:**
- `pulumi-config.enc.yaml` (encrypted config)
- `.sops.yaml` (SOPS configuration)
- `.gitignore`
- Shell scripts

## Setup

```bash
# 1. Install dependencies (one-time)
./install-dependencies.sh

# 2. Generate encryption keys (one-time)
./setup-encryption.sh

# 3. Backup the private key
mkdir -p ~/.sops-backup
cp .sops.age ~/.sops-backup/pulumi-homelab.age
```

## Export Current Config

```bash
# Export from your Pulumi project
./export-config.sh /path/to/pulumi/project

# Or with CLI secrets (no plaintext on disk)
./export-config.sh . cloudflare:apiToken=abc123 homelab:pulumiAccessToken=xyz789
```

Exports all stack configuration and Pulumi ESC environments, then encrypts with AES256-GCM.

**What gets exported:**
- Pulumi stack configuration (public + secrets)
- Pulumi ESC environments accessible to your account
- CLI-provided secrets (passed as arguments)

## Restore to a Stack

### Option 1: Pipe the AGE key from stdin
```bash
cat ~/.sops-backup/pulumi-homelab.age | ./restore-config.sh production
```

### Option 2: AGE key via environment variable
```bash
SOPS_AGE_KEY=$(cat ~/.sops-backup/pulumi-homelab.age) ./restore-config.sh production
```

### Option 3: AGE key file path
```bash
SOPS_AGE_KEY_FILE=~/.sops-backup/pulumi-homelab.age ./restore-config.sh production
```

### Option 4: Local key file (if .sops.age exists)
```bash
cd ~/homelab-config
./restore-config.sh production
```

### Option 5: With CLI secrets override
```bash
SOPS_AGE_KEY=$(cat ~/.sops-backup/pulumi-homelab.age) ./restore-config.sh production \
  cloudflare:apiToken=abc123
```

The restore script will:
1. Decrypt the config using the AGE key
2. Parse the YAML
3. Set all values in the target Pulumi stack
4. Restore ESC environments (requires edit permissions)
5. Show which secrets need manual setup (empty values)

## Edit Encrypted Config

To view or update secret values:

```bash
# If local key file exists
cd ~/homelab-config
sops pulumi-config.enc.yaml

# If key is in different location
SOPS_AGE_KEY_FILE=~/.sops-backup/pulumi-homelab.age sops pulumi-config.enc.yaml

# Or pipe the key
cat ~/.sops-backup/pulumi-homelab.age | SOPS_AGE_KEY_FILE=/dev/stdin sops pulumi-config.enc.yaml
```

SOPS automatically handles encryption when you save.

## Restore on New Machine

```bash
# 1. Copy config repo
git clone <repo> ~/homelab-config

# 2. Restore the key from secure location
cp /secure/location/pulumi-homelab.age ~/.sops-backup/
chmod 600 ~/.sops-backup/pulumi-homelab.age

# 3. Restore to stack
SOPS_AGE_KEY=$(cat ~/.sops-backup/pulumi-homelab.age) ~/homelab-config/restore-config.sh production

# Or pipe it
cat ~/.sops-backup/pulumi-homelab.age | ~/homelab-config/restore-config.sh production
```

## Workflow

### Regular backups
```bash
./export-config.sh /path/to/pulumi/project
git add pulumi-config.enc.yaml
git commit -m "backup: update pulumi config"
```

### Key rotation
```bash
cd ~/.sops-backup

# Generate new key
~/go/bin/age-keygen -o pulumi-homelab.age.new

# Update SOPS config
AGE_PUB=$(~/go/bin/age-keygen -y pulumi-homelab.age.new)
sed -i "s/age: .*/age: $AGE_PUB/" ~/homelab-config/.sops.yaml

# Re-encrypt with new key
SOPS_AGE_KEY_FILE=pulumi-homelab.age.new ~/go/bin/sops -e -i ~/homelab-config/pulumi-config.enc.yaml

# Replace old key
mv pulumi-homelab.age pulumi-homelab.age.old
mv pulumi-homelab.age.new pulumi-homelab.age
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `AGE key not found` | Provide via stdin, env var, or file: `cat key.age \| ./restore-config.sh` |
| `Decryption failed` | Verify AGE key matches the config's public key |
| `no matching creation rules` | Run from `~/homelab-config` or ensure `.sops.yaml` exists |
| `Permission denied` on scripts | `chmod +x *.sh` |
| ESC environment restore fails | Verify you have `pulumi env edit` permissions for the environment |
| ESC environments not exported | Ensure you're logged into Pulumi Cloud: `pulumi login` |

## References

- [SOPS](https://github.com/getsops/sops)
- [AGE](https://github.com/FiloSottile/age)
- [Pulumi Config](https://www.pulumi.com/docs/concepts/config-secrets/)
