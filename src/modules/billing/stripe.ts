import Stripe from "stripe";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError("INTERNAL", "Stripe is not configured", 500);
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

export function portalBaseUrl(): string {
  const origin = env.CORS_ORIGINS.split(",")[0]?.trim();
  if (!origin) {
    throw new AppError("INTERNAL", "CORS_ORIGINS is not configured", 500);
  }
  return origin.replace(/\/$/, "");
}
