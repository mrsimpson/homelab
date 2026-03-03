/**
 * OAuth2-Proxy Group Configuration
 *
 * Single source of truth for group definitions and email allowlists.
 * Each group gets:
 * - Its own ConfigMap with email allowlist
 * - Its own oauth2-proxy Helm release
 * - Its own Traefik ForwardAuth middleware
 * - Its own unique cookie name
 *
 * Workflow to add users:
 * 1. Add email to the appropriate group array
 * 2. Run: pulumi up
 * 3. ConfigMap updates → checksum annotation changes → pod auto-restarts
 */

export const groups: Record<string, string[]> = {
  users: ["github@beimir.net", "dirk.oberhaus@gmx.de"],
};
