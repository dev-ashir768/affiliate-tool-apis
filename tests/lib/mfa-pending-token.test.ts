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
    expect(pending.breakGlass).toBeUndefined();
    expect(pending.targetUserId).toBeUndefined();
  });

  it("round-trips break-glass claims", async () => {
    const token = await signMfaPendingToken("actor_1", {
      breakGlass: true,
      targetUserId: "target_9",
    });
    const pending = await verifyMfaPendingToken(token);
    expect(pending.sub).toBe("actor_1");
    expect(pending.breakGlass).toBe(true);
    expect(pending.targetUserId).toBe("target_9");
  });

  it("rejects breakGlass without targetUserId", async () => {
    await expect(
      signMfaPendingToken("actor_1", {
        breakGlass: true,
        targetUserId: "",
      } as { breakGlass: true; targetUserId: string }),
    ).rejects.toThrow(/targetUserId/);
  });

  it("is rejected by verifyAccessToken", async () => {
    const token = await signMfaPendingToken("user_1");
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});
