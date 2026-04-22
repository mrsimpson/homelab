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
  /**
   * Dedicated GitHub App credentials for this group.
   * When set, a group-specific K8s Secret is created and used instead of the
   * shared "oauth2-proxy-github" secret.  This allows groups with elevated
   * scopes to use a separate GitHub App that has the matching permissions
   * configured, keeping the shared app minimal (user:email only).
   *
   * Values are Pulumi config keys read from the "oauth2-proxy" namespace:
   *   oauth2-proxy:<clientIdKey>        — GitHub App client ID
   *   oauth2-proxy:<clientSecretKey>    — GitHub App client secret
   *   oauth2-proxy:<cookieSecretKey>    — random 32-byte cookie secret
   */
  app?: {
    clientIdKey: string;
    clientSecretKey: string;
    cookieSecretKey: string;
  };
}

export const groups: Record<string, GroupConfig> = {
  users: {
    emails: ["github@beimir.net", "dirk.oberhaus@gmx.de"],
  },
  developers: {
    emails: ["github@beimir.net"],
    scopes: ["user:email", "repo", "read:org", "workflow", "gist"],
    app: {
      clientIdKey: "developersClientId",
      clientSecretKey: "developersClientSecret",
      cookieSecretKey: "developersCookieSecret",
    },
  },
};
