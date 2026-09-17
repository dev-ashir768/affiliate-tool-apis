import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  getNavigation,
  type NavAreaParam,
} from "./navigation.service.js";

export const navigationRoutes = Router();

function parseArea(raw: string): NavAreaParam {
  if (raw === "dashboard" || raw === "backoffice") {
    return raw;
  }
  throw new AppError("VALIDATION_ERROR", "Invalid navigation area", 400);
}

navigationRoutes.get("/:area", authenticate, async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new AppError("UNAUTHORIZED", "Missing access token", 401);
    }
    const area = parseArea(String(req.params.area));
    const nav = await getNavigation(area, req.auth);
    res.json(nav);
  } catch (err) {
    next(err);
  }
});
