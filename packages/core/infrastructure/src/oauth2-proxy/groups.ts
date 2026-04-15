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
 * 1. Add email to the appropriate group's emails array
 * 2. Run: pulumi up
 * 3. ConfigMap updates → checksum annotation changes → pod auto-restarts
 */

export interface GroupConfig {
  emails: string[];
  /**
   * GitHub OAuth scopes to request during the login flow.
   * Omit to use oauth2-proxy's default (user:email).
   * Example: ["user:email", "read:org", "repo"]
   */
  scopes?: string[];
}

export const groups: Record<string, GroupConfig> = {
  users: {
    emails: ["github@beimir.net", "dirk.oberhaus@gmx.de"],
  },
  developers: {
    emails: ["github@beimir.net"],
    scopes: ["user:email", "repo", "read:org", "workflow", "gist"],
  },
};
