import { describe, expect, it } from "vitest";
import { signTikTokRequest } from "../src/lib/tiktok-shop/client.js";

describe("signTikTokRequest", () => {
  it("produces stable HMAC hex for sorted query + body", () => {
    const sign = signTikTokRequest({
      appSecret: "testsecret",
      path: "/affiliate_seller/202508/marketplace_creators/search",
      query: {
        app_key: "app123",
        timestamp: "1700000000",
        shop_cipher: "cipher",
        page_size: "20",
      },
      body: "{}",
    });
    expect(sign).toMatch(/^[a-f0-9]{64}$/);
    expect(
      signTikTokRequest({
        appSecret: "testsecret",
        path: "/affiliate_seller/202508/marketplace_creators/search",
        query: {
          page_size: "20",
          shop_cipher: "cipher",
          timestamp: "1700000000",
          app_key: "app123",
        },
        body: "{}",
      }),
    ).toBe(sign);
  });
});
