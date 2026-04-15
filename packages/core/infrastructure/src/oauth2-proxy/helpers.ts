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
 * Builds the Helm extraArgs object for an oauth2-proxy release.
 * Pure function — no Pulumi dependencies — so it can be unit-tested.
 */
export function buildHelmExtraArgs(
  group: string,
  config: GroupConfig,
  domain: string
): Record<string, string> {
  const args: Record<string, string> = {
    provider: "github",
    "redirect-url": `https://oauth.${domain}/oauth2/callback`,
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
