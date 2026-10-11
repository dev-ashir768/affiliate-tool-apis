import { describe, it, expect } from "vitest";
import {
  signMfaPendingToken,
  verifyMfaPendingToken,
  verifyAccessToken,
} from "../../src/lib/tokens.js";

describe("mfa pending token", () => {
  it("verifies purpose-bound pending token", async () => {
    const token = await signMfaPendingToken("user_1");
    const pending = await verifyMfaPendingToken(token);
    expect(pending.sub).toBe("user_1");
  });

  it("is rejected by verifyAccessToken", async () => {
    const token = await signMfaPendingToken("user_1");
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});
