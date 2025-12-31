# How to: Setup Authelia Authentication

This guide walks you through deploying Authelia as your centralized authentication provider.

## Prerequisites

- Homelab infrastructure deployed (ingress-nginx, cert-manager, External Secrets Operator)
- GitHub and/or Google OAuth app credentials
- Domain configured in Cloudflare

## Step 1: Generate Secrets

Authelia requires several random secrets for encryption and signing.

```bash
# Generate session secret (32 bytes)
openssl rand -base64 32

# Generate storage encryption key (64 bytes)
openssl rand -base64 64

# Generate JWT secret (32 bytes)
openssl rand -base64 32

# Generate PostgreSQL password
openssl rand -base64 32
```

## Step 2: Configure Pulumi Secrets

Store the generated secrets in Pulumi config:

```bash
pulumi config set --secret autheliaSessionSecret "YOUR_SESSION_SECRET"
pulumi config set --secret autheliaStorageEncryptionKey "YOUR_STORAGE_KEY"
pulumi config set --secret autheliaJwtSecret "YOUR_JWT_SECRET"
pulumi config set --secret autheliaPostgresPassword "YOUR_POSTGRES_PASSWORD"
```

## Step 3: Create OAuth Applications

### GitHub OAuth App

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Homelab Authelia`
   - **Homepage URL**: `https://auth.{your-domain}`
   - **Authorization callback URL**: `https://auth.{your-domain}/api/oidc/callback`
4. Click "Register application"
5. Generate a client secret and save both client ID and secret

### Google OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Navigate to APIs & Services → Credentials
4. Click "Create Credentials" → "OAuth client ID"
5. Configure consent screen if prompted
6. Choose "Web application"
7. Add authorized redirect URI: `https://auth.{your-domain}/api/oidc/callback`
8. Save client ID and client secret

## Step 4: Deploy Authelia Infrastructure

Update your infrastructure stack to include Authelia:

```typescript
// In packages/stacks/base-infra/src/index.ts

import { createAuthelia } from "@mrsimpson/homelab-core-infrastructure";
import { homelabConfig } from "@mrsimpson/homelab-config";

// After deploying ingress-nginx and cert-manager...

const authelia = createAuthelia({
  domain: pulumi.interpolate`auth.${homelabConfig.domain}`,
  dependencies: {
    ingressController: ingressNginx.controller,
    externalSecretsOperator: externalSecretsOperator,
  },
  storage: {
    storageClass: "longhorn-persistent",
    size: "1Gi",  // Sufficient for <20 users
  },
});

// Create ingress for Authelia portal
const autheliaIngress = new k8s.networking.v1.Ingress(
  "authelia-ingress",
  {
    metadata: {
      name: "authelia",
      namespace: authelia.namespace.metadata.name,
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-prod",
        "nginx.ingress.kubernetes.io/ssl-redirect": "false",
      },
    },
    spec: {
      ingressClassName: "nginx",
      tls: [
        {
          hosts: [pulumi.interpolate`auth.${homelabConfig.domain}`],
          secretName: "authelia-tls",
        },
      ],
      rules: [
        {
          host: pulumi.interpolate`auth.${homelabConfig.domain}`,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: authelia.service.metadata.name,
                    port: { number: 80 },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
  { dependsOn: [authelia.service, clusterIssuer] }
);

// Update HomelabContext with forward auth configuration
const homelab = new HomelabContext({
  cloudflare: cloudflareConfig,
  tls: tlsConfig,
  ingress: ingressConfig,
  externalSecrets: externalSecretsConfig,
  forwardAuth: {
    verifyUrl: authelia.verifyUrl,
    signinUrl: authelia.signinUrl,
  },
});

export const autheliaUrl = authelia.signinUrl;
```

## Step 5: Deploy and Verify

```bash
# Preview changes
pulumi preview

# Deploy
pulumi up

# Check Authelia is running
kubectl get pods -n authelia

# Check Authelia logs
kubectl logs -n authelia -l app=authelia
```

## Step 6: Create DNS Record

The Cloudflare DNS record for `auth.{domain}` should be automatically created if you configured Cloudflare in the ingress. Verify:

```bash
# Check DNS record exists
dig auth.{your-domain}
```

## Step 7: Access Authelia Portal

Navigate to `https://auth.{your-domain}`. You should see the Authelia login page.

## Step 8: Create Your First User

Authelia uses file-based authentication initially. To create a user:

```bash
# Generate password hash
docker run --rm authelia/authelia:latest \
  authelia crypto hash generate argon2 --password 'YOUR_PASSWORD'

# Edit the users ConfigMap
kubectl edit configmap authelia-users -n authelia
```

Add a user to the `users_database.yml`:

```yaml
users:
  admin:
    disabled: false
    displayname: "Admin User"
    password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Paste hash from above
    email: admin@example.com
    groups:
      - admins
```

Save and restart Authelia:

```bash
kubectl rollout restart deployment/authelia -n authelia
```

## Step 9: Test Login

1. Go to `https://auth.{your-domain}`
2. Login with your username and password
3. You should see "Authenticated" message

## Step 10: Configure Access Policies

Edit the Authelia configuration to add access rules:

```bash
kubectl edit configmap authelia-config -n authelia
```

Add rules under `access_control.rules`:

```yaml
access_control:
  default_policy: deny
  rules:
    # Allow all authenticated users to access hello-world
    - domain: "hello.{your-domain}"
      policy: one_factor

    # Require admin group for secure-demo
    - domain: "secure-demo.{your-domain}"
      policy: two_factor
      subject:
        - "group:admins"

    # Allow specific user for sensitive apps
    - domain: "longhorn.{your-domain}"
      policy: two_factor
      subject:
        - "user:admin"
```

Restart Authelia after changes:

```bash
kubectl rollout restart deployment/authelia -n authelia
```

## Step 11: Deploy Authenticated Apps

Now you can deploy apps with authentication:

```typescript
import { createSecureDemo } from "@mrsimpson/homelab-app-secure-demo";

const { app, url } = createSecureDemo(homelab);
```

The app will automatically be protected by Authelia!

## Step 12: Setup MFA (Optional)

1. Login to Authelia portal
2. Go to Settings → Two-Factor Authentication
3. Click "Register device"
4. Scan QR code with authenticator app (Google Authenticator, Authy, etc.)
5. Enter verification code

## Troubleshooting

### Authelia pods not starting

Check logs:
```bash
kubectl logs -n authelia -l app=authelia
```

Common issues:
- Missing secrets (check `kubectl get secrets -n authelia`)
- PostgreSQL connection failed (check postgres pod)
- Invalid configuration (check ConfigMap syntax)

### Authentication not working

1. Check ingress annotations:
   ```bash
   kubectl get ingress -n {app-namespace} -o yaml
   ```
   Should have `nginx.ingress.kubernetes.io/auth-url` annotation

2. Test Authelia verify endpoint:
   ```bash
   kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
     curl -v http://authelia.authelia.svc.cluster.local/api/verify
   ```
   Should return 401 Unauthorized

3. Check Authelia access logs:
   ```bash
   kubectl logs -n authelia -l app=authelia --tail=100
   ```

### Redirect loops

Check SSL redirect settings:
- Cloudflare Tunnel: SSL redirect should be `false`
- Direct TLS: SSL redirect should be `true`

### Session expires immediately

Check session configuration in Authelia ConfigMap:
- Session domain should be your base domain (without `auth.` prefix)
- Session expiration should be reasonable (1h+)

## Next Steps

- [Setup Supabase with Authelia OIDC](./deploy-supabase.md)
- [Configure GitHub OAuth provider](./configure-github-oauth.md)
- [Setup Google OAuth provider](./configure-google-oauth.md)
- [Configure MFA policies](./configure-mfa.md)

## References

- [ADR 011: Centralized Authentication Stack](../adr/011-centralized-authentication-stack.md)
- [Authelia Documentation](https://www.authelia.com/overview/prologue/introduction/)
- [Authelia Configuration Reference](https://www.authelia.com/configuration/prologue/introduction/)
