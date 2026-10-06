import { Router } from "express";
import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  isTrustedBff,
  rateLimit,
  rateLimitEmailKey,
  rateLimitKey,
} from "../../middleware/rate-limit.js";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import { verifyAccessTokenAllowExpired } from "../../lib/tokens.js";
import {
  getMe,
  login,
  register,
  requestPasswordReset,
  resetPassword,
  revokeRefresh,
  rotateRefresh,
} from "./auth.service.js";
import { refreshTtl } from "./refresh-store.js";

export const authRoutes = Router();

/**
 * Per-route limits keyed by the real client IP (forwarded by the BFF) and, where
 * an email is supplied, by account — one tenant cannot exhaust another's budget.
 */
const limitLoginIp = rateLimit({
  key: rateLimitKey("auth-login"),
  limit: 20,
  windowSec: 60,
  failClosed: true,
});
const limitLoginEmail = rateLimit({
  key: rateLimitEmailKey("auth-login"),
  limit: 10,
  windowSec: 15 * 60,
  failClosed: true,
});
const limitRegister = rateLimit({
  key: rateLimitKey("auth-register"),
  limit: 10,
  windowSec: 60 * 60,
  failClosed: true,
});
const limitForgotIp = rateLimit({
  key: rateLimitKey("auth-forgot"),
  limit: 10,
  windowSec: 60 * 60,
  failClosed: true,
});
const limitForgotEmail = rateLimit({
  key: rateLimitEmailKey("auth-forgot"),
  limit: 3,
  windowSec: 60 * 60,
  failClosed: true,
});
const limitReset = rateLimit({
  key: rateLimitKey("auth-reset"),
  limit: 10,
  windowSec: 15 * 60,
  failClosed: true,
});
// Refresh runs on navigations; fail open so a Redis blip never logs users out.
const limitRefresh = rateLimit({
  key: rateLimitKey("auth-refresh"),
  limit: 120,
  windowSec: 60,
});

function cookieSecure(): boolean {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE;
  return env.NODE_ENV === "production";
}

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: refreshTtl() * 1000,
    path: "/",
  };
}

/**
 * Include refreshToken in JSON only for trusted portal BFF.
 * - PORTAL_BFF_SECRET unset: legacy behavior (return token; set secret in prod to lock down)
 * - secret set: require matching X-Portal-Bff-Secret header
 */
function mayReturnRefreshInBody(req: Request): boolean {
  if (!env.PORTAL_BFF_SECRET) return true;
  return isTrustedBff(req);
}

function authTokenPayload(
  req: Request,
  tokens: { accessToken: string; refreshToken: string },
) {
  if (mayReturnRefreshInBody(req)) {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }
  return { accessToken: tokens.accessToken };
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie("refresh_token", refreshToken, refreshCookieOptions());
}

function clearRefreshCookie(res: Response) {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
  });
}

function rawRefreshFromRequest(req: {
  body?: { refreshToken?: string };
  cookies?: Record<string, string>;
}): string {
  const fromBody = req.body?.refreshToken;
  const fromCookie = req.cookies?.refresh_token;
  const raw = fromCookie || fromBody;
  if (!raw) {
    throw new AppError("UNAUTHORIZED", "Missing refresh token", 401);
  }
  return raw;
}

authRoutes.post("/register", limitRegister, validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await register(req.body);
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({
      user: result.user,
      organization: result.organization,
      platformMembership: result.platformMembership,
      redirectTo: result.redirectTo,
      ...authTokenPayload(req, result),
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/login", limitLoginIp, validateBody(loginSchema), limitLoginEmail, async (req, res, next) => {
  try {
    const result = await login(req.body);
    setRefreshCookie(res, result.refreshToken);
    res.json({
      user: result.user,
      organizationId: result.organizationId,
      platformMembership: result.platformMembership,
      redirectTo: result.redirectTo,
      ...authTokenPayload(req, result),
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/refresh", limitRefresh, validateBody(refreshSchema), async (req, res, next) => {
  try {
    const raw = rawRefreshFromRequest(req);
    // The prior (usually expired) access token only hints which org to keep.
    let hint: { sub: string; orgId: string | null } | null = null;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const access = header.slice("Bearer ".length).trim();
      if (access) {
        try {
          const prior = await verifyAccessTokenAllowExpired(access);
          hint = { sub: prior.sub, orgId: prior.orgId };
        } catch {
          // Bad signature — fall back to first ACTIVE membership
        }
      }
    }
    const result = await rotateRefresh(raw, hint);
    setRefreshCookie(res, result.refreshToken);
    res.json(authTokenPayload(req, result));
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/logout", validateBody(refreshSchema), async (req, res, next) => {
  try {
    const raw = req.cookies?.refresh_token || req.body?.refreshToken;
    if (raw) {
      await revokeRefresh(raw);
    }
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRoutes.get("/me", authenticate, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const me = await getMe(req.auth.sub, req.auth.orgId);
    res.json(me);
  } catch (err) {
    next(err);
  }
});

authRoutes.post(
  "/forgot-password",
  limitForgotIp,
  validateBody(forgotPasswordSchema),
  limitForgotEmail,
  async (req, res, next) => {
    try {
      const result = await requestPasswordReset(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

authRoutes.post(
  "/reset-password",
  limitReset,
  validateBody(resetPasswordSchema),
  async (req, res, next) => {
    try {
      const result = await resetPassword(req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
