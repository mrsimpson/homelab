# ADR 002: Cloudflare Tunnel for Internet Exposure

## Status

Implemented

## Context

Homelab services need to be accessible from the internet for remote access and sharing. Traditional approaches involve port forwarding on the home router, which exposes the network to direct attacks and doesn't work behind CGNAT (Carrier-Grade NAT) that many ISPs now use.

We need a solution that provides secure internet exposure without opening inbound ports, works behind restrictive networking setups, and handles TLS certificate management automatically.

## Decision

We will use Cloudflare Tunnel (cloudflared) for exposing services to the internet.

The tunnel creates an outbound-only connection from our homelab to Cloudflare's edge network, allowing public access to services without any inbound firewall configuration.

## Consequences

### Positive

- **Enhanced security** - Zero inbound ports open on home router, eliminating port scanning attacks
- **CGNAT compatibility** - Works regardless of ISP NAT configuration or lack of public IP
- **Enterprise protection** - Cloudflare's DDoS mitigation, WAF, and bot detection protect services
- **Automatic TLS** - Cloudflare handles certificate provisioning and management at the edge
- **Global performance** - Low latency worldwide through Cloudflare's CDN edge network
- **DNS integration** - Automatic DNS record management through Pulumi
- **Infrastructure as code** - Tunnel configuration manageable via Pulumi
- **Network flexibility** - Works from any network (home, mobile, VPN)

### Negative

- **External dependency** - Cloudflare outage blocks all internet access to homelab services
- **Vendor lock-in** - Migration away from Cloudflare requires significant reconfiguration
- **Privacy considerations** - All traffic passes through Cloudflare's infrastructure
- **Free tier limitations** - May hit usage limits requiring paid plan upgrade
- **Troubleshooting complexity** - Network issues may occur at Cloudflare edge, harder to debug

### Neutral

- **Additional component** - cloudflared daemon must run and be monitored in the homelab
- **Configuration learning** - Team needs to understand Cloudflare Tunnel concepts and management
- **Backup access** - Should maintain alternative access method in case of tunnel issues