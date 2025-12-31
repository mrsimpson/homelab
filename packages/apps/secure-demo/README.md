# Secure Demo App

Example application demonstrating Authelia forward authentication integration.

## Overview

This app shows how to protect a web application using Authelia's forward authentication pattern:

- **No sidecar containers** - Authentication handled at ingress level
- **Single configuration** - Just set `requireAuth: true`
- **SSO enabled** - Users log in once for all apps
- **Centralized policies** - Access control managed in Authelia

## Architecture

```
User → Cloudflare → ingress-nginx → Authelia (verify) → secure-demo app
                           ↓
                    (if not authed, redirect to Authelia login)
```

## How It Works

1. User accesses `https://secure-demo.{domain}`
2. nginx-ingress forwards auth check to Authelia (`/api/verify`)
3. If user is not authenticated:
   - Redirect to `https://auth.{domain}`
   - User logs in via GitHub/Google
   - Authelia creates session
   - User redirected back to app
4. If user is authenticated:
   - Authelia returns 200 OK + headers
   - nginx forwards request to app with auth headers:
     - `Remote-User`: username
     - `Remote-Email`: email address
     - `Remote-Groups`: group memberships

## Usage

```typescript
import { createSecureDemo } from "@mrsimpson/homelab-app-secure-demo";

// In your infrastructure code
const { app, url } = createSecureDemo(homelab);

pulumi.export("secureDemoUrl", url);
```

## Configuration

The app automatically inherits forward-auth configuration from the HomelabContext. No per-app configuration needed!

To change access policies, update Authelia's ACL configuration in the Authelia ConfigMap.

## Testing

1. Deploy the app: `pulumi up`
2. Navigate to `https://secure-demo.{domain}`
3. You should be redirected to Authelia login
4. After logging in, you'll see the nginx welcome page
5. Check nginx logs to see the auth headers:
   ```bash
   kubectl logs -n secure-demo -l app=secure-demo
   ```

## See Also

- [ADR 011: Centralized Authentication Stack](../../../docs/adr/011-centralized-authentication-stack.md)
- [Authelia Documentation](https://www.authelia.com/)
- [How to: Setup Authelia](../../../docs/howto/setup-authelia.md)
