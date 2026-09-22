import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import {
  isRetryableTikTokError,
  mapTikTokOpenApiError,
  throwMappedTikTokError,
} from "../src/lib/tiktok-shop/errors.js";

describe("mapTikTokOpenApiError", () => {
  it("maps rate limit 36009002 / HTTP 429", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 429,
      body: { code: 36009002, message: "Too many requests." },
    });
    expect(m.appCode).toBe("RATE_LIMITED");
    expect(m.status).toBe(429);
    expect(m.category).toBe("rate_limit");
  });

  it("maps expired token 105002", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: { code: 105002, message: "Expired credentials." },
    });
    expect(m.appCode).toBe("UNAUTHORIZED");
    expect(m.category).toBe("auth");
    expect(m.remediation).toMatch(/Refresh/i);
  });

  it("maps invalid signature 106001", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: { code: 106001, message: "signature is invalid" },
    });
    expect(m.appCode).toBe("FAILED_PRECONDITION");
    expect(m.category).toBe("signature");
  });

  it("maps scope denial 105005", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: {
        code: 105005,
        message: "Access denied. The app is not authorized",
      },
    });
    expect(m.appCode).toBe("FORBIDDEN");
    expect(m.remediation).toMatch(/scope/i);
  });

  it("branches 36009004 by message keyword (timestamp)", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: {
        code: 36009004,
        message:
          "Invalid timestamp. The value of the timestamp query parameter must not be earlier than 5 minutes before the current time.",
      },
    });
    expect(m.appCode).toBe("FAILED_PRECONDITION");
    expect(m.category).toBe("timestamp");
    expect(m.messageKeyword).toBe("timestamp, earlier than 5 minutes");
  });

  it("branches 36009004 invalid app_key", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: {
        code: 36009004,
        message: "Invalid credentials. Invalid app_key query parameter.",
      },
    });
    expect(m.messageKeyword).toBe("Invalid app_key");
    expect(m.category).toBe("auth");
  });

  it("maps missing shop_cipher 106013", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: { code: 106013, message: "Missing identifier." },
    });
    expect(m.appCode).toBe("FAILED_PRECONDITION");
    expect(m.remediation).toMatch(/shop_cipher/i);
  });

  it("maps IP allow list 36009033", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: { code: 36009033, message: "Access denied." },
    });
    expect(m.appCode).toBe("FORBIDDEN");
    expect(m.remediation).toMatch(/IP/i);
  });

  it("maps marketplace daily quota 45101004 as non-retryable rate limit", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: {
        code: 45101004,
        message: "The query quota has been reached (10000 request per day).",
      },
    });
    expect(m.appCode).toBe("RATE_LIMITED");
    expect(isRetryableTikTokError(m, 45101004)).toBe(false);
  });

  it("maps 36009003 internal error as retryable upstream", () => {
    const m = mapTikTokOpenApiError({
      httpStatus: 200,
      body: { code: 36009003, message: "Internal error." },
    });
    expect(m.appCode).toBe("BAD_GATEWAY");
    expect(isRetryableTikTokError(m, 36009003)).toBe(true);
  });

  it("throwMappedTikTokError attaches request_id + docs in details", () => {
    try {
      throwMappedTikTokError({
        httpStatus: 200,
        path: "/affiliate_seller/202508/marketplace_creators/search",
        body: {
          code: 105002,
          message: "Expired credentials.",
          request_id: "req-abc-123",
        },
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe("UNAUTHORIZED");
      expect(e.details).toMatchObject({
        provider: "tiktok_shop",
        tiktokCode: 105002,
        requestId: "req-abc-123",
        category: "auth",
      });
      expect((e.details as { docs: string }).docs).toContain("common-errors");
    }
  });
});
