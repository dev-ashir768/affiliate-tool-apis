import Stripe from "stripe";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export { portalBaseUrl } from "../../lib/portal-base-url.js";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError("INTERNAL", "Stripe is not configured", 500);
  }
  if (!client) {
    // Pin API version once tested; omit to use account default for newer Stripe SDKs.
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }
  return client;
}
