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

export const authenticateMfaPending: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing MFA pending token", 401);
    }
    const { sub } = await verifyMfaPendingToken(header.slice(7).trim());
    req.mfaUserId = sub;
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired MFA challenge", 401));
  }
};
