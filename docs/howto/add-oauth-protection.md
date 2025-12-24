# How to Add OAuth Protection

## Goal

Require users to authenticate via OAuth (Google, GitHub, etc.) before accessing a service.

## Prerequisites

- Service already exposed (see [expose-web-app.md](expose-web-app.md))
- OAuth application created with provider (Google/GitHub/etc.)

## Why OAuth Protection?

OAuth2 Proxy acts as an authentication gateway:
- Users must authenticate via OAuth provider before accessing your app
- App itself doesn't need to implement authentication
- Can restrict by email, domain, or organization
- Session cookies for persistent authentication

## Step 1: Create OAuth Application

Choose your provider and follow setup:

### Option A: Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create Project (if needed)
3. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
4. Application type: "Web application"
5. Authorized redirect URIs:
   ```
   https://yourapp.yourdomain.com/oauth2/callback
   ```
6. Click "Create"
7. **Copy Client ID and Client Secret**

### Option B: GitHub OAuth

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - Application name: `Your App Name`
   - Homepage URL: `https://yourapp.yourdomain.com`
   - Authorization callback URL: `https://yourapp.yourdomain.com/oauth2/callback`
4. Click "Register application"
5. **Copy Client ID**
6. Click "Generate a new client secret"
7. **Copy Client Secret**

### Option C: Generic OIDC Provider

For Keycloak, Authentik, Authelia, etc.:
1. Create new OAuth/OIDC client in your provider
2. Set redirect URI: `https://yourapp.yourdomain.com/oauth2/callback`
3. Note your:
   - Client ID
   - Client Secret
   - Issuer URL (e.g., `https://auth.example.com/realms/myrealm`)

## Step 2: Configure Pulumi Secrets

Store OAuth credentials in Pulumi config:

```bash
cd homelab/infrastructure

# For Google
pulumi config set myAppGoogleClientId YOUR_CLIENT_ID
pulumi config set myAppGoogleSecret YOUR_SECRET --secret

# For GitHub
pulumi config set myAppGitHubClientId YOUR_CLIENT_ID
pulumi config set myAppGitHubSecret YOUR_SECRET --secret

# For OIDC
pulumi config set myAppOIDCClientId YOUR_CLIENT_ID
pulumi config set myAppOIDCSecret YOUR_SECRET --secret
pulumi config set myAppOIDCIssuerURL https://auth.example.com/realms/myrealm
```

**Note:** `--secret` encrypts the value in Pulumi state.

## Step 3: Update Application Code

Edit your app file (e.g., `packages/apps/my-app/src/index.ts`):

```typescript
import { ExposedWebApp } from "../components/ExposedWebApp";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

export const myApp = new ExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain: "app.yourdomain.com",
  port: 80,

  // Add OAuth configuration
  oauth: {
    provider: "google",  // or "github" or "oidc"
    clientId: config.require("myAppGoogleClientId"),
    clientSecret: config.requireSecret("myAppGoogleSecret"),

    // Optional: Restrict access
    allowedEmails: ["you@example.com", "friend@example.com"]
  }
});
```

### For Google with Domain Restriction

```typescript
oauth: {
  provider: "google",
  clientId: config.require("myAppGoogleClientId"),
  clientSecret: config.requireSecret("myAppGoogleSecret"),
  allowedDomains: ["example.com"]  // Only users @example.com
}
```

### For GitHub with Organization Restriction

```typescript
oauth: {
  provider: "github",
  clientId: config.require("myAppGitHubClientId"),
  clientSecret: config.requireSecret("myAppGitHubSecret"),
  allowedOrgs: ["my-organization"]  // Only org members
}
```

### For OIDC Provider

```typescript
oauth: {
  provider: "oidc",
  clientId: config.require("myAppOIDCClientId"),
  clientSecret: config.requireSecret("myAppOIDCSecret"),
  oidcIssuerUrl: config.require("myAppOIDCIssuerURL"),
  allowedEmails: ["you@example.com"]
}
```

## Step 4: Deploy

```bash
pulumi up
```

Pulumi shows the changes:

```
Updating (dev):
  ~ homelab:ExposedWebApp  my-app       update
  ~  ├─ kubernetes:apps/v1:Deployment  my-app  update
  ~  │  └─ containers changed (added oauth-proxy sidecar)
  ~  └─ kubernetes:core/v1:Service     my-app  update
       └─ targetPort changed (80 → 4180)

Resources:
  ~ 2 updated
  4 unchanged
```

Type `yes` to deploy.

## Step 5: Test

1. Visit `https://app.yourdomain.com`
2. Should redirect to OAuth provider (Google/GitHub)
3. Sign in with your account
4. Should redirect back to your app
5. **If not in allowed list:** See "403 Forbidden"
6. **If allowed:** See your app!

### Clear Session (for testing)

```bash
# Clear cookies for yourdomain.com in browser
# Or use incognito/private window
```

## How It Works

### OAuth Sidecar Pattern

The component adds an OAuth2 Proxy sidecar container to your pod:

```
┌──────────────────────────────────────┐
│  Pod: my-app                         │
│                                      │
│  ┌────────────────┐  ┌────────────┐ │
│  │ oauth-proxy    │  │ nginx      │ │
│  │ :4180          │  │ :80        │ │
│  │                │  │            │ │
│  │ Checks auth ──→│  │ App logic  │ │
│  │ Proxies to     │  │            │ │
│  │ localhost:80   │  │            │ │
│  └────────────────┘  └────────────┘ │
│         ↑                            │
└─────────┼────────────────────────────┘
          │
    Internet traffic
  (via Cloudflare Tunnel)
```

**Traffic flow:**
1. User request arrives at OAuth proxy (port 4180)
2. OAuth proxy checks for valid session cookie
3. If no cookie: Redirect to OAuth provider
4. If cookie invalid: Redirect to OAuth provider
5. If cookie valid: Proxy request to app on localhost:80
6. App receives request (with auth headers)

### Security Benefits

- ✅ App never directly exposed (not even in cluster)
- ✅ Sidecar shares pod network (localhost communication)
- ✅ OAuth provider validates identity
- ✅ Session cookies encrypted and signed
- ✅ No application code changes needed

## Configuration Options

### Provider-Specific

```typescript
oauth: {
  provider: "google" | "github" | "oidc";
  clientId: string;
  clientSecret: pulumi.Input<string>;

  // OIDC only
  oidcIssuerUrl?: string;
}
```

### Access Control

```typescript
oauth: {
  // ... provider config

  // By email (any provider)
  allowedEmails?: string[];

  // By domain (Google)
  allowedDomains?: string[];

  // By organization (GitHub)
  allowedOrgs?: string[];
}
```

### Session Configuration

```typescript
oauth: {
  // ... provider config

  // Session timeout (default: 24h)
  cookieExpire?: string;  // e.g., "12h", "30d"

  // Cookie domain (default: same as app domain)
  cookieDomain?: string;
}
```

## Advanced: Multiple Providers

To allow login via multiple providers, set up separate OAuth apps and use `provider: "oidc"` with a federated identity provider (Keycloak, Authentik, etc.) that supports multiple upstream providers.

## Troubleshooting

### Redirect Loop

```bash
# Check oauth-proxy logs
kubectl logs deployment/my-app -c oauth-proxy

# Common causes:
# - Cookie domain mismatch
# - Redirect URI not matching OAuth app config
# - HTTPS not working (OAuth requires HTTPS)
```

**Fix:** Verify redirect URI in OAuth app matches exactly:
```
https://app.yourdomain.com/oauth2/callback
```

### 403 Forbidden (after successful login)

```bash
# Check oauth-proxy logs
kubectl logs deployment/my-app -c oauth-proxy

# Will show: "email user@example.com not in allowed list"
```

**Fix:** Add email to `allowedEmails` or adjust restriction:

```typescript
oauth: {
  // ...
  allowedEmails: ["user@example.com"]  // Add the user's email
}
```

### "Invalid Client" Error

```bash
# OAuth provider rejects the client credentials
```

**Fix:**
- Verify Client ID and Secret are correct
- Re-create OAuth app if needed
- Check provider-specific settings (e.g., app not published)

### Session Expires Too Quickly

```typescript
oauth: {
  // ...
  cookieExpire: "7d"  // Extend to 7 days
}
```

### Want to Skip OAuth for Certain Paths

Not currently supported by ExposedWebApp component. You would need to:
1. Configure OAuth2 Proxy manually with `skip-auth-regex`
2. Or deploy without OAuth and implement auth in app

## Next Steps

- [Set Up Persistent Storage](setup-persistent-storage.md) - Add storage to your protected app
- [Deploy a Database](deploy-database.md) - Add database with persistent storage

## Removing OAuth Protection

Simply remove the `oauth` block from your component:

```typescript
export const myApp = new ExposedWebApp("my-app", {
  image: "nginx:alpine",
  domain: "app.yourdomain.com",
  port: 80
  // Removed: oauth: { ... }
});
```

```bash
pulumi up
# OAuth sidecar will be removed, app becomes public
```
