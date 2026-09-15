import { Router } from "express";
import type { CookieOptions, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schemas.js";
import {
  getMe,
  login,
  register,
  revokeRefresh,
  rotateRefresh,
} from "./auth.service.js";
import { refreshTtl } from "./refresh-store.js";

export const authRoutes = Router();

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: refreshTtl() * 1000,
    path: "/",
  };
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie("refresh_token", refreshToken, refreshCookieOptions());
}

function clearRefreshCookie(res: Response) {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  });
}

function rawRefreshFromRequest(req: {
  body?: { refreshToken?: string };
  cookies?: Record<string, string>;
}): string {
  const fromBody = req.body?.refreshToken;
  const fromCookie = req.cookies?.refresh_token;
  const raw = fromBody || fromCookie;
  if (!raw) {
    throw new AppError("UNAUTHORIZED", "Missing refresh token", 401);
  }
  return raw;
}

authRoutes.post("/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await register(req.body);
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({
      user: result.user,
      organization: result.organization,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await login(req.body);
    setRefreshCookie(res, result.refreshToken);
    res.json({
      user: result.user,
      organizationId: result.organizationId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/refresh", validateBody(refreshSchema), async (req, res, next) => {
  try {
    const raw = rawRefreshFromRequest(req);
    const result = await rotateRefresh(raw);
    setRefreshCookie(res, result.refreshToken);
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/logout", validateBody(refreshSchema), async (req, res, next) => {
  try {
    const raw = req.body?.refreshToken || req.cookies?.refresh_token;
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
