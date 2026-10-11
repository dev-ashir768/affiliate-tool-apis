import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../src/lib/errors.js";
import {
  signAccessToken,
  signMfaPendingToken,
} from "../../src/lib/tokens.js";
import { authenticate } from "../../src/middleware/authenticate.js";
import { authenticateMfaPending } from "../../src/middleware/authenticate-mfa-pending.js";

function mockReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as Request;
}

async function runMiddleware(
  mw: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
  req: Request,
): Promise<{ err: unknown; nextCalledWithError: boolean }> {
  const next = vi.fn() as NextFunction;
  await mw(req, {} as Response, next);
  const err = next.mock.calls[0]?.[0];
  return { err, nextCalledWithError: err !== undefined };
}

describe("authenticate vs MFA pending token", () => {
  it("rejects MFA pending token", async () => {
    const pending = await signMfaPendingToken("user_mfa");
    const req = mockReq(`Bearer ${pending}`);
    const { err } = await runMiddleware(authenticate, req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(401);
    expect(req.auth).toBeUndefined();
  });

  it("accepts access token", async () => {
    const access = await signAccessToken({
      sub: "user_access",
      orgId: null,
      orgRole: null,
      platformRole: null,
      hasProductAccess: false,
    });
    const req = mockReq(`Bearer ${access}`);
    const { err } = await runMiddleware(authenticate, req);
    expect(err).toBeUndefined();
    expect(req.auth?.sub).toBe("user_access");
  });
});

describe("authenticateMfaPending", () => {
  it("accepts MFA pending token and sets mfaUserId", async () => {
    const pending = await signMfaPendingToken("user_mfa");
    const req = mockReq(`Bearer ${pending}`);
    const { err } = await runMiddleware(authenticateMfaPending, req);
    expect(err).toBeUndefined();
    expect(req.mfaUserId).toBe("user_mfa");
  });

  it("rejects access token", async () => {
    const access = await signAccessToken({
      sub: "user_access",
      orgId: null,
      orgRole: null,
      platformRole: null,
      hasProductAccess: false,
    });
    const req = mockReq(`Bearer ${access}`);
    const { err } = await runMiddleware(authenticateMfaPending, req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("UNAUTHORIZED");
    expect((err as AppError).status).toBe(401);
    expect(req.mfaUserId).toBeUndefined();
  });

  it("rejects missing Bearer token", async () => {
    const req = mockReq();
    const { err } = await runMiddleware(authenticateMfaPending, req);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toBe("Invalid or expired MFA challenge");
  });
});
