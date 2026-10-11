import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { verifyMfaPendingToken } from "../lib/tokens.js";

declare global {
  namespace Express {
    interface Request {
      mfaUserId?: string;
    }
  }
}

/** Bearer from Authorization (BFF); falls back to the mfa_pending cookie (portal). */
function mfaPendingTokenFrom(req: {
  headers: { authorization?: string };
  cookies?: Record<string, string>;
}): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  const cookie = req.cookies?.mfa_pending;
  return typeof cookie === "string" && cookie ? cookie : null;
}

export const authenticateMfaPending: RequestHandler = async (req, _res, next) => {
  try {
    const token = mfaPendingTokenFrom(req);
    if (!token) throw new Error("Missing MFA pending token");
    const { sub } = await verifyMfaPendingToken(token);
    req.mfaUserId = sub;
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired MFA challenge", 401));
  }
};
