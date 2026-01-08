# How to: Use Forward Authentication

Quick reference for protecting apps with Authelia forward authentication.

## Basic Usage

Enable authentication for any app by setting `requireAuth: true`:

```typescript
const app = homelab.createExposedWebApp("my-app", {
  image: "my-image:latest",
  domain: "my-app.example.com",
  port: 8080,
  requireAuth: true,  // That's it!
});
```

## What Happens

1. **Ingress annotations added automatically**:
   ```yaml
   nginx.ingress.kubernetes.io/auth-url: "http://authelia.authelia.svc.cluster.local/api/verify"
   nginx.ingress.kubernetes.io/auth-signin: "https://auth.example.com"
   nginx.ingress.kubernetes.io/auth-response-headers: "Remote-User,Remote-Email,Remote-Groups"
   ```

2. **User visits app** → nginx checks with Authelia
3. **If not authenticated** → Redirect to Authelia login
4. **If authenticated** → Forward request with auth headers

## Access Auth Headers in Your App

Authelia forwards these headers to your application:

- `Remote-User`: Username (e.g., `john`)
- `Remote-Email`: Email address (e.g., `john@example.com`)
- `Remote-Groups`: Comma-separated groups (e.g., `admins,developers`)

### Node.js/Express Example

```javascript
app.get('/', (req, res) => {
  const user = req.headers['remote-user'];
  const email = req.headers['remote-email'];
  const groups = req.headers['remote-groups']?.split(',') || [];

  res.json({
    user,
    email,
    groups,
    isAdmin: groups.includes('admins')
  });
});
```

### Python/Flask Example

```python
from flask import Flask, request, jsonify

@app.route('/')
def index():
    user = request.headers.get('Remote-User')
    email = request.headers.get('Remote-Email')
    groups = request.headers.get('Remote-Groups', '').split(',')

    return jsonify({
        'user': user,
        'email': email,
        'groups': groups,
        'is_admin': 'admins' in groups
    })
```

## Configure Access Policies

Edit Authelia ConfigMap to control who can access what:

```bash
kubectl edit configmap authelia-config -n authelia
```

### Examples

**Allow all authenticated users**:
```yaml
- domain: "my-app.example.com"
  policy: one_factor
```

**Require MFA**:
```yaml
- domain: "sensitive-app.example.com"
  policy: two_factor
```

**Restrict to specific users**:
```yaml
- domain: "admin-app.example.com"
  policy: two_factor
  subject:
    - "user:admin"
    - "user:john"
```

**Restrict to group**:
```yaml
- domain: "team-app.example.com"
  policy: one_factor
  subject:
    - "group:developers"
```

**Protect specific paths**:
```yaml
- domain: "my-app.example.com"
  policy: bypass
  resources:
    - "^/public/.*$"

- domain: "my-app.example.com"
  policy: two_factor
  resources:
    - "^/admin/.*$"

- domain: "my-app.example.com"
  policy: one_factor
```

After updating policies:
```bash
kubectl rollout restart deployment/authelia -n authelia
```

## Disable Auth for Specific App

Simply don't set `requireAuth` or set it to `false`:

```typescript
const app = homelab.createExposedWebApp("public-app", {
  image: "my-image:latest",
  domain: "public.example.com",
  port: 8080,
  // requireAuth: false,  // Default is false
});
```

## Advantages

✅ **No sidecar overhead** - Saves 50-100MB RAM per app
✅ **Single sign-on** - Login once, access all apps
✅ **Configure once** - Policies in one place
✅ **Centralized management** - Add/remove users in Authelia
✅ **Better security** - MFA, brute-force protection, audit logs
✅ **Scalable** - Unlimited apps, no performance impact

## Troubleshooting

**App not requiring authentication**:
- Check `requireAuth: true` is set
- Verify HomelabContext has `forwardAuth` configured
- Check ingress annotations: `kubectl get ingress -n {namespace} -o yaml`

**Redirect loop**:
- Check SSL redirect setting matches your setup
- Cloudflare Tunnel: `ssl-redirect: false`
- Direct TLS: `ssl-redirect: true`

**Headers not received**:
- Verify response headers annotation exists
- Check nginx-ingress logs for errors
- Test with: `curl -H "Remote-User: test" http://localhost`

## See Also

- [Setup Authelia](./setup-authelia.md)
- [ADR 011: Centralized Authentication Stack](../adr/011-centralized-authentication-stack.md)
- [Authelia Access Control](https://www.authelia.com/configuration/security/access-control/)
