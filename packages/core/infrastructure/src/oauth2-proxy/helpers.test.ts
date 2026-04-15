import { describe, expect, it } from "vitest";
import {
  buildChecksum,
  buildEmailContent,
  buildHelmExtraArgs,
} from "./helpers";

describe("buildEmailContent", () => {
  it("joins emails with newline", () => {
    expect(buildEmailContent(["a@b.com", "c@d.com"])).toBe("a@b.com\nc@d.com");
  });

  it("handles a single email", () => {
    expect(buildEmailContent(["only@one.com"])).toBe("only@one.com");
  });
});

describe("buildChecksum", () => {
  it("returns a 12-character hex string", () => {
    const result = buildChecksum("hello");
    expect(result).toHaveLength(12);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(buildChecksum("same input")).toBe(buildChecksum("same input"));
  });

  it("changes with different input", () => {
    expect(buildChecksum("a")).not.toBe(buildChecksum("b"));
  });
});

describe("buildHelmExtraArgs", () => {
  const baseEmails = ["user@example.com"];

  it("uses shared redirect-url when no callbackSubdomain", () => {
    const args = buildHelmExtraArgs("users", { emails: baseEmails }, "example.com");
    expect(args["redirect-url"]).toBe("https://oauth.example.com/oauth2/callback");
  });

  it("omits scope key when no scopes configured", () => {
    const args = buildHelmExtraArgs("users", { emails: baseEmails }, "example.com");
    expect(args["scope"]).toBeUndefined();
  });

  it("sets scope as space-joined string when scopes configured", () => {
    const args = buildHelmExtraArgs(
      "dev",
      { emails: baseEmails, scopes: ["user:email", "repo"] },
      "example.com"
    );
    expect(args["scope"]).toBe("user:email repo");
  });

  it("includes standard cookie and proxy args", () => {
    const args = buildHelmExtraArgs("mygroup", { emails: baseEmails }, "test.com");
    expect(args["cookie-name"]).toBe("_oauth2_mygroup");
    expect(args["cookie-domain"]).toBe(".test.com");
    expect(args["provider"]).toBe("github");
  });
});
