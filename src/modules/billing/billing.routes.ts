import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { validateBody } from "../../middleware/validate.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireOrg } from "../../middleware/require-org.js";
import { requireRole } from "../../middleware/require-role.js";
import { getStripe } from "./stripe.js";
import { handleStripeEvent } from "./webhook.service.js";
import {
  createCheckoutSession,
  createPortalSession,
  listPlans,
} from "./billing.service.js";

const checkoutSessionSchema = z.object({
  planCode: z.string().min(1),
});

export const billingRoutes = Router();

billingRoutes.get("/plans", async (_req, res, next) => {
  try {
    const plans = await listPlans();
    res.json({ plans });
  } catch (err) {
    next(err);
  }
});

billingRoutes.post(
  "/checkout-session",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  validateBody(checkoutSessionSchema),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.auth.sub },
      });
      const session = await createCheckoutSession({
        organizationId: req.auth.orgId,
        planCode: req.body.planCode,
        actorEmail: user.email,
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  }
);

billingRoutes.post(
  "/portal-session",
  authenticate,
  requireOrg,
  requireRole("OWNER", "ADMIN"),
  async (req, res, next) => {
    try {
      if (!req.auth?.orgId) {
        throw new AppError("UNAUTHORIZED", "Missing access token", 401);
      }
      const session = await createPortalSession({
        organizationId: req.auth.orgId,
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  }
);

export const billingWebhookHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError("INTERNAL", "Stripe webhook secret is not configured", 500);
    }
    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      throw new AppError("UNAUTHORIZED", "Missing Stripe signature", 401);
    }

    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );

    await handleStripeEvent(event as any);
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
};
