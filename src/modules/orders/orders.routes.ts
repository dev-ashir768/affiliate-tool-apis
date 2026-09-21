import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { createOrderSchema } from "../discovery/discovery.schemas.js";
import {
  analyticsOverview,
  createOrder,
  listOrders,
} from "./orders.service.js";

export const ordersRoutes = Router();

ordersRoutes.use(authenticate, requireOrg);

ordersRoutes.get("/", async (req, res, next) => {
  try {
    if (!req.auth?.orgId) throw new AppError("UNAUTHORIZED", "Missing org", 401);
    res.json(await listOrders(req.auth.orgId));
  } catch (err) {
    next(err);
  }
});

ordersRoutes.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  validateBody(createOrderSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.status(201).json(await createOrder(req.auth.orgId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

export const analyticsRoutes = Router();

analyticsRoutes.get(
  "/overview",
  authenticate,
  requireOrg,
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing org", 401);
      }
      res.json(await analyticsOverview(req.auth.orgId));
    } catch (err) {
      next(err);
    }
  }
);
