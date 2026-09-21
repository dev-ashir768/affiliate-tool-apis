import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { orgsRoutes } from "./modules/orgs/orgs.routes.js";
import {
  billingRoutes,
  billingWebhookHandler,
} from "./modules/billing/billing.routes.js";
import { shopsRoutes } from "./modules/shops/shops.routes.js";
import { creatorsRoutes } from "./modules/creators/creators.routes.js";
import { outreachRoutes } from "./modules/outreach/outreach.routes.js";
import {
  discoveryRoutes,
  platformDiscoveryRoutes,
} from "./modules/discovery/discovery.routes.js";
import {
  analyticsRoutes,
  ordersRoutes,
} from "./modules/orders/orders.routes.js";
import { navigationRoutes } from "./modules/navigation/navigation.routes.js";
import { platformRoutes } from "./modules/platform/platform.routes.js";

export function createApp() {
  const app = express();
  if (env.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post(
    "/api/v1/webhooks/stripe",
    express.raw({ type: "application/json" }),
    billingWebhookHandler
  );
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/orgs", orgsRoutes);
  app.use("/api/v1/billing", billingRoutes);
  app.use("/api/v1/shops", shopsRoutes);
  app.use("/api/v1/creators", creatorsRoutes);
  app.use("/api/v1/outreach", outreachRoutes);
  app.use("/api/v1/discovery", discoveryRoutes);
  app.use("/api/v1/orders", ordersRoutes);
  app.use("/api/v1/analytics", analyticsRoutes);
  app.use("/api/v1/navigation", navigationRoutes);
  app.use("/api/v1/platform", platformRoutes);
  app.use("/api/v1/platform/discovery", platformDiscoveryRoutes);
  app.use(errorHandler);
  return app;
}
