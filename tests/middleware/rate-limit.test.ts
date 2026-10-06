import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { rateLimit, rateLimitKey } from "../../src/middleware/rate-limit.js";
import { AppError } from "../../src/lib/errors.js";

vi.mock("../../src/lib/redis.js", () => {
  const redis = {
    status: "wait" as string,
    connect: vi.fn(async () => {
      throw new Error("unreachable");
    }),
    eval: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  };
  return { redis };
});

import { redis } from "../../src/lib/redis.js";

function mockReq(ip = "127.0.0.1"): Request {
  return { ip, socket: { remoteAddress: ip } } as Request;
}

describe("rateLimit middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (redis as { status: string }).status = "wait";
  });

  it("fails open when Redis is unavailable (default)", async () => {
    const mw = rateLimit({
      key: rateLimitKey("creators"),
      limit: 2,
      windowSec: 60,
    });
    const next = vi.fn() as NextFunction;
    await mw(mockReq(), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("fails closed when Redis is unavailable and failClosed=true", async () => {
    const mw = rateLimit({
      key: rateLimitKey("auth"),
      limit: 2,
      windowSec: 60,
      failClosed: true,
    });
    const next = vi.fn() as NextFunction;
    await mw(mockReq(), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(503);
  });

  it("returns 429 AppError when over limit", async () => {
    (redis as { status: string }).status = "ready";
    (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const mw = rateLimit({
      key: rateLimitKey("auth"),
      limit: 2,
      windowSec: 60,
    });
    const next = vi.fn() as NextFunction;
    await mw(mockReq("10.0.0.1"), {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("RATE_LIMITED");
    expect((err as AppError).status).toBe(429);
  });

  it("allows when under limit", async () => {
    (redis as { status: string }).status = "ready";
    (redis.eval as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const mw = rateLimit({
      key: rateLimitKey("auth"),
      limit: 20,
      windowSec: 60,
    });
    const next = vi.fn() as NextFunction;
    await mw(mockReq(), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });
});

describe("clientIp / tenant keys", () => {
  it("trusts X-Client-IP only with the BFF secret", async () => {
    const { clientIp } = await import("../../src/middleware/rate-limit.js");
    const { env } = await import("../../src/config/env.js");
    const base = { ip: "10.0.0.1", socket: { remoteAddress: "10.0.0.1" } };

    const trusted = {
      ...base,
      headers: {
        "x-portal-bff-secret": env.PORTAL_BFF_SECRET,
        "x-client-ip": "203.0.113.7",
      },
    } as unknown as Request;
    expect(clientIp(trusted)).toBe("203.0.113.7");

    const spoofed = {
      ...base,
      headers: { "x-portal-bff-secret": "wrong", "x-client-ip": "203.0.113.7" },
    } as unknown as Request;
    expect(clientIp(spoofed)).toBe("10.0.0.1");

    const garbage = {
      ...base,
      headers: {
        "x-portal-bff-secret": env.PORTAL_BFF_SECRET,
        "x-client-ip": "not an ip; drop",
      },
    } as unknown as Request;
    expect(clientIp(garbage)).toBe("10.0.0.1");
  });

  it("keys tenant limits by org, then user", async () => {
    const { rateLimitTenantKey, rateLimitEmailKey } = await import(
      "../../src/middleware/rate-limit.js"
    );
    const withOrg = {
      auth: { sub: "u1", orgId: "o1" },
    } as unknown as Request;
    expect(rateLimitTenantKey("x")(withOrg)).toBe("x:org:o1");
    const userOnly = { auth: { sub: "u1", orgId: null } } as unknown as Request;
    expect(rateLimitTenantKey("x")(userOnly)).toBe("x:user:u1");
    const body = { body: { email: " A@B.com " } } as unknown as Request;
    expect(rateLimitEmailKey("login")(body)).toBe("login:email:a@b.com");
  });
});
