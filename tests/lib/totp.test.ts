import { describe, it, expect } from "vitest";
import { authenticator } from "otplib";
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  buildOtpauthUrl,
} from "../../src/lib/totp.js";

describe("totp helpers", () => {
  it("verifies current code for generated secret", () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("builds otpauth url", () => {
    const url = buildOtpauthUrl("a@b.com", "SECRET");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("a%40b.com");
  });

  it("generates 10 backup codes with stable hashes", () => {
    const { raw, hashes } = generateBackupCodes();
    expect(raw).toHaveLength(10);
    expect(hashes).toHaveLength(10);
    expect(hashBackupCode(raw[0]!)).toBe(hashes[0]);
  });
});
