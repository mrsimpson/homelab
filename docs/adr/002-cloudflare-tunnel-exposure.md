# ADR 002: Cloudflare Tunnel for Internet Exposure

**Status:** Accepted
**Date:** 2025-12-21
**Deciders:** Project maintainers

## Context

Homelab services need to be accessible from the internet. Traditional approaches involve port forwarding on the home router, which exposes the network to attacks and doesn't work behind CGNAT.

## Decision

Use **Cloudflare Tunnel** (cloudflared) for exposing services to the internet.

## Rationale

### Security Benefits

**No Inbound Ports:**
- Zero ports open on home router/firewall
- All connections are outbound-only from homelab to Cloudflare
- Eliminates port scanning attacks
- Home IP address not directly exposed

**Cloudflare Protection:**
- Enterprise-grade DDoS mitigation (100+ Tbps capacity)
- Web Application Firewall (WAF) at edge
- Rate limiting and bot detection
- Automatic TLS at edge

**Works Behind CGNAT:**
- Many ISPs use Carrier-Grade NAT (no public IP available)
- Cloudflare Tunnel bypasses this entirely
- Works on any network (even mobile hotspot)

### Operational Benefits

**Automatic TLS:**
- Cloudflare handles certificate provisioning
- No Let's Encrypt rate limits to manage
- Certificates managed at edge, not at home

**DNS Integration:**
- Cloudflare DNS automatically updated
- No dynamic DNS services needed
- Managed via Pulumi (infrastructure as code)

**Global CDN:**
- Low latency from anywhere in the world
- Cloudflare's edge network
- Built-in caching (optional)

## How It Works

```
User → Cloudflare Edge → Encrypted Tunnel → cloudflared (homelab) → Ingress → Service → Pod
```

1. **cloudflared daemon** runs in k3s cluster
2. Establishes 4 persistent **outbound** connections to Cloudflare
3. Cloudflare routes incoming traffic through these connections
4. Traffic arrives at Ingress controller in cluster
5. Routed to appropriate service based on hostname

## Trade-offs

### Accepted

**Cloudflare Can See Traffic:**
- Tunnel terminates TLS at Cloudflare edge
- Cloudflare can decrypt and inspect traffic
- **Mitigation:** Only use for non-sensitive or properly encrypted services
- **Alternative:** Use Tailscale VPN for sensitive admin access

**Cloudflare Dependency:**
- Reliant on Cloudflare's availability
- If Cloudflare is down, services are inaccessible
- **Mitigation:** Keep Tailscale VPN as backup access method

**Free Tier Limits:**
- Bandwidth limits on free tier (though generous)
- **Mitigation:** Acceptable for homelab use

### Benefits Outweigh Costs

For a homelab exposing personal projects:
- ✅ Security benefits are substantial
- ✅ DDoS protection alone is worth it
- ✅ Free tier is sufficient
- ✅ Works behind CGNAT
- ⚠️ Traffic visibility acceptable for public services

## Alternatives Considered

### Port Forwarding (Traditional)

**Pros:**
- Simple, no third party
- Direct connection (lowest latency)

**Cons:**
- ❌ Opens ports to internet (attack vector)
- ❌ Exposes home IP address
- ❌ Doesn't work behind CGNAT
- ❌ No DDoS protection
- ❌ Requires dynamic DNS
- ❌ Manual certificate management

**Verdict:** Too insecure for internet exposure

### Tailscale Funnel

**Pros:**
- ✅ End-to-end encrypted (Tailscale can't see traffic)
- ✅ Built on WireGuard
- ✅ Simpler than Cloudflare setup

**Cons:**
- ❌ Must use `.ts.net` subdomain (can't use custom domain)
- ❌ Limited ports (443, 8443, 10000)
- ❌ Bandwidth limits
- ❌ Less suitable for truly public services
- ❌ No enterprise DDoS protection

**Verdict:** Better for private access, worse for public services

### Tailscale VPN (Subnet Router)

**Pros:**
- ✅ True end-to-end encryption
- ✅ Zero-trust networking
- ✅ Can access entire homelab

**Cons:**
- ❌ Not suitable for public services
- ❌ Requires Tailscale client on user devices

**Verdict:** Use this for admin access, not public exposure

### VPS + Reverse Proxy

**Pros:**
- Full control
- Can use custom domains
- Static IP

**Cons:**
- ❌ Costs money (VPS hosting)
- ❌ Another server to maintain
- ❌ Still need tunnel or VPN from VPS to homelab
- ❌ No DDoS protection (unless add Cloudflare anyway)

**Verdict:** More complex and costly than Cloudflare Tunnel

### ngrok / Bore / FRP (Self-Hosted Tunnels)

**Pros:**
- More control
- Can self-host

**Cons:**
- ❌ No DDoS protection
- ❌ ngrok paid plans for custom domains
- ❌ FRP/Bore require VPS or exit node anyway
- ❌ More operational burden

**Verdict:** Cloudflare Tunnel simpler and more secure

## Implementation

### Cloudflare Tunnel Setup

1. Pulumi creates Cloudflare Tunnel resource
2. `cloudflared` deployment runs in k3s cluster
3. Authenticates to Cloudflare with tunnel token
4. Maintains persistent outbound connections

### DNS Management

1. Pulumi creates DNS records (CNAME to tunnel endpoint)
2. Points `app.example.com` → `tunnel-id.cfargotunnel.com`
3. Cloudflare automatically routes traffic

### Per-Service Configuration

When `ExposedWebApp` component is instantiated:
1. Creates Kubernetes Ingress with hostname
2. Creates Cloudflare DNS record
3. Creates Cloudflare Tunnel route mapping hostname → ingress

All managed by Pulumi - no manual Cloudflare dashboard config.

## Security Considerations

**What We Trust:**
- Cloudflare to handle TLS properly
- Cloudflare not to tamper with traffic
- Cloudflare's uptime

**What We Don't Trust:**
- Public internet (no direct exposure)
- Random scanners (can't find homelab)

**Additional Security Layers:**
- OAuth2 Proxy for sensitive services
- Tailscale VPN for administrative access
- Network policies within cluster (future)

## Monitoring

- Cloudflare dashboard for traffic analytics
- Tunnel health via `cloudflared` metrics
- Alerts if tunnel disconnects

## References

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [cloudflared GitHub](https://github.com/cloudflare/cloudflared)
- [Pulumi Cloudflare Provider](https://www.pulumi.com/registry/packages/cloudflare/)
