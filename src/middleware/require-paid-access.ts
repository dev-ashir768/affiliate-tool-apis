import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { assertProductAccess } from "../lib/entitlements.js";

/**
 * Merchant product routes require ACTIVE / TRIALING / PAST_DUE subscription.
 * Platform staff acting without org context are not covered here (requireOrg first).
 */
export async function requirePaidAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth?.orgId) {
      throw new AppError("UNAUTHORIZED", "Missing organization", 401);
    }
    // Platform staff browsing merchant APIs still need the org to be paid.
    await assertProductAccess(req.auth.orgId);
    next();
  } catch (err) {
    next(err);
  }
}
