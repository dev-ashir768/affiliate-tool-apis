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

  it("fails open when Redis is unavailable", async () => {
    const mw = rateLimit({
      key: rateLimitKey("auth"),
      limit: 2,
      windowSec: 60,
    });
    const next = vi.fn() as NextFunction;
    await mw(mockReq(), {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
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
