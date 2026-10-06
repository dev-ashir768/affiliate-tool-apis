import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  sha256,
} from "../../src/lib/tokens.js";

describe("tokens", () => {
  it("round-trips access JWT", async () => {
    const token = await signAccessToken({
      sub: "user1",
      orgId: "org1",
      orgRole: "OWNER",
      platformRole: null,
    });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("user1");
    expect(claims.orgId).toBe("org1");
    expect(claims.orgRole).toBe("OWNER");
    expect(claims.platformRole).toBeNull();
  });

  it("hashes refresh tokens", () => {
    const { raw, hash } = generateRefreshToken();
    expect(hash).toBe(sha256(raw));
    expect(raw).not.toBe(hash);
  });
});

describe("verifyAccessTokenAllowExpired", () => {
  it("accepts an expired but correctly signed token, rejects tampering", async () => {
    const { SignJWT } = await import("jose");
    const { env } = await import("../../src/config/env.js");
    const { verifyAccessTokenAllowExpired } = await import(
      "../../src/lib/tokens.js"
    );
    const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ orgId: "org9" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user9")
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 60)
      .sign(key);

    await expect(verifyAccessToken(expired)).rejects.toThrow();
    const claims = await verifyAccessTokenAllowExpired(expired);
    expect(claims).toMatchObject({ sub: "user9", orgId: "org9" });

    const forged = await new SignJWT({ orgId: "org9" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user9")
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode("x".repeat(40)));
    await expect(verifyAccessTokenAllowExpired(forged)).rejects.toThrow();
  });
});
