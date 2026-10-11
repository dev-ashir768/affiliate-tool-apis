import { Router } from "express";
import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authenticateMfaPending } from "../../middleware/authenticate-mfa-pending.js";
import {
  isTrustedBff,
  rateLimit,
  rateLimitEmailKey,
  rateLimitKey,
} from "../../middleware/rate-limit.js";
import {
  adminResetTotpSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  totpCodeSchema,
  verifyTotpSchema,
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
import { requirePlatform } from "../../middleware/require-platform.js";
import {
  adminResetTwoFactor,
  confirmTotpSetup,
  getTwoFactorStatus,
  regenerateBackupCodes,
  revokeTrustedDevice,
  startTotpSetup,
  TRUSTED_DEVICE_TTL_MS,
  verifyTotpLogin,
} from "./two-factor.service.js";

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
const limitTotpSetup = rateLimit({
  key: rateLimitKey("auth-2fa-setup"),
  limit: 5,
  windowSec: 60,
  failClosed: true,
});
const limitTotpVerify = rateLimit({
  key: rateLimitKey("auth-2fa-verify"),
  limit: 5,
  windowSec: 60,
  failClosed: true,
});
const limitTotpRegenerate = rateLimit({
  key: rateLimitKey("auth-2fa-regenerate"),
  limit: 5,
  windowSec: 60,
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

function mfaPendingCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: env.MFA_PENDING_TTL_SEC * 1000,
    path: "/",
  };
}

function trustedDeviceCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    maxAge: TRUSTED_DEVICE_TTL_MS,
    path: "/",
  };
}

function clearMfaPendingCookie(res: Response) {
  res.clearCookie("mfa_pending", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
  });
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
    logger.warn("refresh rejected", { reason: "missing_token" });
    throw new AppError("UNAUTHORIZED", "Missing refresh token", 401);
  }
  return raw;
}

/** Sets the mfa_pending cookie; JSON carries the token when mayReturnRefreshInBody (same gate as refreshToken). */
function sendMfaChallenge(
  req: Request,
  res: Response,
  statusCode: number,
  result: {
    status: "mfa_setup" | "mfa_required";
    mfaPendingToken: string;
    user: { id: string; email: string; name: string };
  },
  extra: Record<string, unknown> = {},
) {
  res.cookie("mfa_pending", result.mfaPendingToken, mfaPendingCookieOptions());
  res.status(statusCode).json({
    status: result.status,
    user: result.user,
    ...extra,
    ...(mayReturnRefreshInBody(req) ? { mfaPendingToken: result.mfaPendingToken } : {}),
  });
}

authRoutes.post("/register", limitRegister, validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await register(req.body);
    sendMfaChallenge(req, res, 201, result, {
      organization: result.organization,
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/login", limitLoginIp, validateBody(loginSchema), limitLoginEmail, async (req, res, next) => {
  try {
    const trustedDeviceRaw = req.cookies?.trusted_device as string | undefined;
    const result = await login({ ...req.body, trustedDeviceRaw });
    if (result.status !== "authenticated") {
      sendMfaChallenge(req, res, 200, result);
      return;
    }
    clearMfaPendingCookie(res);
    setRefreshCookie(res, result.refreshToken);
    res.json({
      status: result.status,
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

authRoutes.post(
  "/2fa/setup/start",
  limitTotpSetup,
  authenticateMfaPending,
  async (req, res, next) => {
    try {
      const result = await startTotpSetup(req.mfaUserId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

authRoutes.post(
  "/2fa/setup/confirm",
  limitTotpSetup,
  authenticateMfaPending,
  validateBody(totpCodeSchema),
  async (req, res, next) => {
    try {
      const result = await confirmTotpSetup(req.mfaUserId!, req.body.code);
      clearMfaPendingCookie(res);
      setRefreshCookie(res, result.refreshToken);
      res.json({
        status: result.status,
        backupCodes: result.backupCodes,
        user: result.user,
        organizationId: result.organizationId,
        platformMembership: result.platformMembership,
        redirectTo: result.redirectTo,
        ...authTokenPayload(req, result),
      });
    } catch (err) {
      next(err);
    }
  }
);

authRoutes.post(
  "/2fa/verify",
  limitTotpVerify,
  authenticateMfaPending,
  validateBody(verifyTotpSchema),
  async (req, res, next) => {
    try {
      const result = await verifyTotpLogin(req.mfaUserId!, req.body.code, {
        rememberDevice: req.body.rememberDevice,
        userAgent: req.get("user-agent") ?? undefined,
      });
      clearMfaPendingCookie(res);
      setRefreshCookie(res, result.refreshToken);
      if (result.trustedDeviceRaw) {
        res.cookie("trusted_device", result.trustedDeviceRaw, trustedDeviceCookieOptions());
      }
      res.json({
        status: result.status,
        user: result.user,
        organizationId: result.organizationId,
        platformMembership: result.platformMembership,
        redirectTo: result.redirectTo,
        ...authTokenPayload(req, result),
      });
    } catch (err) {
      next(err);
    }
  }
);

authRoutes.get("/2fa/status", authenticate, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    res.json(await getTwoFactorStatus(req.auth.sub));
  } catch (err) {
    next(err);
  }
});

authRoutes.delete("/2fa/trusted-devices/:id", authenticate, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    await revokeTrustedDevice(req.auth.sub, String(req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
authRoutes.post(
  "/2fa/backup-codes/regenerate",
  limitTotpRegenerate,
  authenticate,
  validateBody(totpCodeSchema),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const backupCodes = await regenerateBackupCodes(req.auth.sub, req.body.code);
      res.json({ backupCodes });
    } catch (err) {
      next(err);
    }
  }
);

authRoutes.post(
  "/2fa/admin/reset",
  authenticate,
  requirePlatform("SUPERADMIN"),
  validateBody(adminResetTotpSchema),
  async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      await adminResetTwoFactor(req.auth.sub, req.body.userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);
