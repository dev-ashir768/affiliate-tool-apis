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
      role: "OWNER",
    });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("user1");
    expect(claims.orgId).toBe("org1");
    expect(claims.role).toBe("OWNER");
  });

  it("hashes refresh tokens", () => {
    const { raw, hash } = generateRefreshToken();
    expect(hash).toBe(sha256(raw));
    expect(raw).not.toBe(hash);
  });
});
