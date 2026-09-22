import { describe, expect, it } from "vitest";
import {
  signOAuthState,
  verifyOAuthState,
} from "../src/lib/tiktok-shop/oauth.js";

describe("tiktok oauth state", () => {
  it("round-trips signed state", () => {
    const state = signOAuthState({
      orgId: "org_1",
      shopId: "shop_1",
      userId: "user_1",
      exp: Date.now() + 60_000,
    });
    const parsed = verifyOAuthState(state);
    expect(parsed.orgId).toBe("org_1");
    expect(parsed.shopId).toBe("shop_1");
    expect(parsed.userId).toBe("user_1");
  });

  it("rejects tampered state", () => {
    const state = signOAuthState({
      orgId: "org_1",
      shopId: "shop_1",
      userId: "user_1",
      exp: Date.now() + 60_000,
    });
    expect(() => verifyOAuthState(state + "x")).toThrow();
  });
});
