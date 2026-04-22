import * as crypto from "node:crypto";
import type { GroupConfig } from "./groups";

/**
 * Builds the email content string for the allowlist ConfigMap.
 */
export function buildEmailContent(emails: string[]): string {
  return emails.join("\n");
}

/**
 * Returns the first 12 hex characters of the SHA-256 hash of the input.
 * Used as a pod annotation checksum to trigger restarts when emails change.
 */
export function buildChecksum(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/**
 * Returns the OAuth2 callback URL for a given group.
 * Default group ("users") uses the root path for backwards compatibility.
 * Other groups use a path prefix so each can be registered as a separate
 * callback URL in the GitHub App (which supports multiple callback URLs).
 */
export function callbackUrl(group: string, domain: string): string {
  return group === "users"
    ? `https://oauth.${domain}/oauth2/callback`
    : `https://oauth.${domain}/${group}/oauth2/callback`;
}

export function buildHelmExtraArgs(
  group: string,
  config: GroupConfig,
  domain: string,
): Record<string, string> {
  const args: Record<string, string> = {
    provider: "github",
    "redirect-url": callbackUrl(group, domain),
    "whitelist-domain": `.${domain}`,
    "skip-provider-button": "true",
    "cookie-name": `_oauth2_${group}`,
    "cookie-domain": `.${domain}`,
    "cookie-secure": "true",
    "cookie-httponly": "true",
    "cookie-samesite": "lax",
    "cookie-expire": "168h",
    "cookie-refresh": "1h",
    "set-xauthrequest": "true",
    "reverse-proxy": "true",
    "pass-user-headers": "true",
    "pass-access-token": "true",
    "cookie-csrf-per-request": "true",
  };

  if (config.scopes && config.scopes.length > 0) {
    args["scope"] = config.scopes.join(" ");
  }

  return args;
}
