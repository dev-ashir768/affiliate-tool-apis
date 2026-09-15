import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { orgsRoutes } from "./modules/orgs/orgs.routes.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  // JSON parser for non-webhook routes (billing webhook raw body added in Task 8)
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/orgs", orgsRoutes);
  app.use(errorHandler);
  return app;
}
