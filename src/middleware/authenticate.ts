import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken, type AccessClaims } from "../lib/tokens.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessClaims;
    }
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    req.auth = await verifyAccessToken(token);
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError("UNAUTHORIZED", "Invalid access token", 401));
  }
};
