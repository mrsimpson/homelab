# How to: Manage Access Control with Authelia

Guide for configuring who can access which applications in your homelab.

## Overview

Access control in Authelia is **centralized** - you configure policies in one place (Authelia ConfigMap) rather than in each application. Apps just set `requireAuth: true` and Authelia handles the rest.

## Quick Start

### 1. Deploy App with Auth Enabled

```typescript
const app = homelab.createExposedWebApp("my-app", {
  image: "my-image:latest",
  domain: "my-app.example.com",
  port: 8080,
  requireAuth: true,  // Forward-auth enabled
});
```

### 2. Add Access Policy

```bash
kubectl edit configmap authelia-config -n authelia
```

Add rule:

```yaml
access_control:
  default_policy: deny
  rules:
    - domain: "my-app.example.com"
      policy: one_factor  # Require login
```

### 3. Apply Changes

```bash
kubectl rollout restart deployment/authelia -n authelia
```

### 4. Test

Navigate to `https://my-app.example.com` - you should be redirected to login.

## Policy Levels

| Policy | Description | Auth Required | MFA Required |
|--------|-------------|---------------|--------------|
| `bypass` | No authentication | ❌ | ❌ |
| `one_factor` | Username + password | ✅ | ❌ |
| `two_factor` | Username + password + MFA | ✅ | ✅ |
| `deny` | Always block access | N/A | N/A |

## Access Control Patterns

### Pattern 1: Public App (No Auth)

Allow anyone to access without login:

```yaml
- domain: "public.example.com"
  policy: bypass
```

### Pattern 2: Any Authenticated User

Require login, but allow any user:

```yaml
- domain: "hello.example.com"
  policy: one_factor
```

### Pattern 3: Specific Users Only

Restrict to named users:

```yaml
- domain: "admin-panel.example.com"
  policy: two_factor
  subject:
    - "user:admin@example.com"
    - "user:owner@example.com"
```

### Pattern 4: Group-Based Access

Restrict to users in specific groups:

```yaml
- domain: "team-dashboard.example.com"
  policy: one_factor
  subject:
    - "group:admins"
    - "group:team-leads"
```

### Pattern 5: Path-Based Rules

Different rules for different paths:

```yaml
# Public homepage
- domain: "myapp.example.com"
  policy: bypass
  resources:
    - "^/$"
    - "^/public/.*$"

# API requires auth
- domain: "myapp.example.com"
  policy: one_factor
  resources:
    - "^/api/.*$"

# Admin section requires MFA
- domain: "myapp.example.com"
  policy: two_factor
  resources:
    - "^/admin/.*$"
  subject:
    - "group:admins"
```

### Pattern 6: Wildcard Domains

Protect multiple subdomains:

```yaml
# Default for all subdomains
- domain: "*.example.com"
  policy: one_factor

# Override specific subdomain
- domain: "public.example.com"
  policy: bypass
```

### Pattern 7: Network-Based Restrictions

Restrict by IP address/network:

```yaml
- domain: "admin.example.com"
  policy: two_factor
  subject:
    - "group:admins"
  networks:
    - "192.168.1.0/24"  # Only from home network
```

## Complete Example Configuration

Realistic homelab setup with 5-10 apps:

```yaml
access_control:
  default_policy: deny  # Block everything by default

  rules:
    # Public apps - no auth needed
    - domain: "blog.example.com"
      policy: bypass

    # General apps - any authenticated user
    - domain: "hello.example.com"
      policy: one_factor

    - domain: "nodejs-demo.example.com"
      policy: one_factor

    - domain: "storage-validator.example.com"
      policy: one_factor

    # Infrastructure - admins only with MFA
    - domain: "longhorn.example.com"
      policy: two_factor
      subject:
        - "group:admins"

    - domain: "authelia.example.com"
      policy: two_factor
      subject:
        - "user:admin@example.com"

    # Monitoring - ops team
    - domain: "monitoring.example.com"
      policy: one_factor
      subject:
        - "group:ops"
        - "group:admins"

    # Supabase - developers
    - domain: "supabase.example.com"
      policy: one_factor
      subject:
        - "group:developers"
        - "group:admins"

    # Secure demo - test MFA
    - domain: "secure-demo.example.com"
      policy: two_factor
```

## Managing Users

### Create New User

1. **Generate password hash**:

```bash
docker run --rm authelia/authelia:latest \
  authelia crypto hash generate argon2 --password 'YourSecurePassword123'
```

Output:
```
$argon2id$v=19$m=65536,t=3,p=4$abc123...
```

2. **Edit users ConfigMap**:

```bash
kubectl edit configmap authelia-users -n authelia
```

3. **Add user**:

```yaml
users:
  alice:
    disabled: false
    displayname: "Alice Developer"
    password: "$argon2id$v=19$m=65536,t=3,p=4$..."  # Paste hash from above
    email: alice@example.com
    groups:
      - developers
```

4. **Restart Authelia**:

```bash
kubectl rollout restart deployment/authelia -n authelia
```

### Disable User

```yaml
users:
  alice:
    disabled: true  # Change to true
    displayname: "Alice Developer"
    password: "$argon2id$..."
    email: alice@example.com
    groups:
      - developers
```

### Update User Password

Generate new hash and update `password` field, then restart Authelia.

### Delete User

Remove the user entry from the ConfigMap and restart Authelia.

## Managing Groups

Groups are defined in user entries:

```yaml
users:
  admin:
    displayname: "Admin User"
    password: "$argon2id$..."
    email: admin@example.com
    groups:
      - admins

  alice:
    displayname: "Alice Developer"
    password: "$argon2id$..."
    email: alice@example.com
    groups:
      - developers
      - team-leads

  bob:
    displayname: "Bob Ops"
    password: "$argon2id$..."
    email: bob@example.com
    groups:
      - ops
      - developers
```

### Common Group Structure

For a small homelab with <20 users:

```yaml
groups:
  - admins       # Full access to everything
  - developers   # Access to dev tools, Supabase, apps
  - ops          # Access to monitoring, infrastructure
  - users        # Access to general apps only
```

## Rule Precedence

**First matching rule wins** - order matters!

```yaml
access_control:
  default_policy: deny

  rules:
    # Specific rules first
    - domain: "admin.example.com"
      policy: two_factor
      subject:
        - "group:admins"

    # More general rules last
    - domain: "*.example.com"
      policy: one_factor
```

In this example:
- `admin.example.com` → Requires MFA (first rule)
- `other.example.com` → Requires login (second rule)

## Workflow: Adding a New App

### Step 1: Deploy App

```typescript
const app = homelab.createExposedWebApp("new-app", {
  image: "my-image:latest",
  domain: "new-app.example.com",
  port: 8080,
  requireAuth: true,
});
```

```bash
pulumi up
```

### Step 2: Add Access Rule

```bash
kubectl edit configmap authelia-config -n authelia
```

Add rule under `access_control.rules`:

```yaml
- domain: "new-app.example.com"
  policy: one_factor
  subject:
    - "group:developers"
```

### Step 3: Restart Authelia

```bash
kubectl rollout restart deployment/authelia -n authelia
```

### Step 4: Test Access

1. Navigate to `https://new-app.example.com`
2. You should be redirected to Authelia login
3. Login as a user in the `developers` group
4. You should be redirected back to the app

### Step 5: Verify Logs

```bash
# Check Authelia logs for access decision
kubectl logs -n authelia -l app=authelia --tail=50

# Check app received auth headers
kubectl logs -n new-app -l app=new-app --tail=20
```

## Common Scenarios

### Scenario 1: Grant Access to New User

```yaml
# Add user to existing group
users:
  charlie:
    disabled: false
    displayname: "Charlie"
    password: "$argon2id$..."
    email: charlie@example.com
    groups:
      - developers  # Charlie now has access to all apps with group:developers
```

Restart Authelia - Charlie can now access all apps that allow `group:developers`.

### Scenario 2: Revoke Access

**Option A: Disable user entirely**

```yaml
users:
  charlie:
    disabled: true  # Can't login at all
```

**Option B: Remove from group**

```yaml
users:
  charlie:
    displayname: "Charlie"
    password: "$argon2id$..."
    email: charlie@example.com
    groups: []  # Remove all groups
```

### Scenario 3: Temporary Admin Access

```yaml
users:
  charlie:
    displayname: "Charlie"
    password: "$argon2id$..."
    email: charlie@example.com
    groups:
      - developers
      - admins  # Add temporarily
```

Later, remove `admins` from the groups list.

### Scenario 4: App Requires MFA

```yaml
- domain: "sensitive-app.example.com"
  policy: two_factor  # Require MFA
```

Users must set up MFA:
1. Login to Authelia portal: `https://auth.example.com`
2. Go to Settings → Two-Factor Authentication
3. Scan QR code with authenticator app
4. Enter verification code

## Troubleshooting

### User Can't Access App

1. **Check access policy**:

```bash
kubectl get configmap authelia-config -n authelia -o yaml
```

Verify there's a matching rule for the domain.

2. **Check user groups**:

```bash
kubectl get configmap authelia-users -n authelia -o yaml
```

Verify user is in the required group.

3. **Check Authelia logs**:

```bash
kubectl logs -n authelia -l app=authelia --tail=100 | grep "Access"
```

Look for access decisions (allow/deny).

### App Not Requiring Auth

1. **Check ingress annotations**:

```bash
kubectl get ingress -n my-app my-app -o yaml
```

Should have:
```yaml
annotations:
  nginx.ingress.kubernetes.io/auth-url: "http://authelia.authelia.svc.cluster.local/api/verify"
  nginx.ingress.kubernetes.io/auth-signin: "https://auth.example.com"
```

2. **Check ForwardAuth config**:

Verify HomelabContext has `forwardAuth` configured.

3. **Check requireAuth**:

Verify app has `requireAuth: true` in deployment.

### Redirect Loop

1. **Check SSL redirect settings**:

```yaml
nginx.ingress.kubernetes.io/ssl-redirect: "false"  # Should be false with Cloudflare Tunnel
```

2. **Check session domain**:

In Authelia config:
```yaml
session:
  domain: example.com  # Should be base domain (no auth. prefix)
```

### Access Denied for Valid User

1. **Check rule order** - More specific rules should come first
2. **Check subject format**:
   - User: `user:alice` or `user:alice@example.com`
   - Group: `group:developers`
3. **Restart Authelia** after config changes

## Best Practices

1. **Default Deny** - Start with `default_policy: deny`, then allow specific access
2. **Use Groups** - Easier to manage than individual users
3. **MFA for Sensitive** - Use `two_factor` for admin/infrastructure apps
4. **Test Incrementally** - Add one rule at a time
5. **Document Groups** - Keep a list of what each group can access
6. **Monitor Logs** - Regularly check access patterns
7. **Rotate Passwords** - Encourage users to rotate every 90 days
8. **Backup Configs** - Keep backups of user/config ConfigMaps

## Security Tips

1. **Strong Passwords** - Enforce minimum complexity
2. **Enable MFA** - Require for all admin accounts
3. **Limit Admin Group** - Keep admins group small (1-3 users)
4. **Audit Regularly** - Review who has access quarterly
5. **Remove Unused Users** - Disable accounts that haven't logged in 90+ days
6. **Network Restrictions** - Use IP restrictions for sensitive apps
7. **Session Timeouts** - Keep session expiration reasonable (1-4 hours)

## Helper Scripts

### Generate Password Hash

```bash
#!/bin/bash
# save as: scripts/hash-password.sh

if [ -z "$1" ]; then
  echo "Usage: $0 <password>"
  exit 1
fi

docker run --rm authelia/authelia:latest \
  authelia crypto hash generate argon2 --password "$1"
```

Usage:
```bash
chmod +x scripts/hash-password.sh
./scripts/hash-password.sh 'MySecurePassword123'
```

### List All Users and Groups

```bash
#!/bin/bash
# save as: scripts/list-users.sh

kubectl get configmap authelia-users -n authelia -o jsonpath='{.data.users_database\.yml}' | \
  yq eval '.users | to_entries | .[] | .key + " (" + .value.email + ") - " + (.value.groups | join(", "))'
```

### Apply Authelia Changes

```bash
#!/bin/bash
# save as: scripts/apply-authelia-changes.sh

echo "Restarting Authelia..."
kubectl rollout restart deployment/authelia -n authelia

echo "Waiting for rollout..."
kubectl rollout status deployment/authelia -n authelia

echo "Authelia restarted successfully!"
```

## Reference

### ConfigMap Locations

- **Access policies**: `authelia-config` ConfigMap in `authelia` namespace
- **Users/groups**: `authelia-users` ConfigMap in `authelia` namespace

### Edit Commands

```bash
# Edit access policies
kubectl edit configmap authelia-config -n authelia

# Edit users
kubectl edit configmap authelia-users -n authelia

# Restart Authelia
kubectl rollout restart deployment/authelia -n authelia
```

### Log Commands

```bash
# Watch Authelia logs
kubectl logs -n authelia -l app=authelia -f

# Check access decisions
kubectl logs -n authelia -l app=authelia --tail=100 | grep -i "access"

# Check authentication attempts
kubectl logs -n authelia -l app=authelia --tail=100 | grep -i "auth"
```

## See Also

- [Setup Authelia](./setup-authelia.md) - Initial deployment
- [Use Forward Auth](./use-forward-auth.md) - App integration
- [ADR 011: Centralized Authentication](../adr/011-centralized-authentication-stack.md) - Architecture decision
- [Authelia Access Control Docs](https://www.authelia.com/configuration/security/access-control/)
