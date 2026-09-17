import { env } from "../config/env.js";
import { ShopVerifyTerminalError } from "./shop-verify.errors.js";

export function resolveLiveInviteUrl(region: "US" | "UK"): string {
  const url =
    region === "UK" ? env.SHOP_VERIFY_LIVE_URL_UK : env.SHOP_VERIFY_LIVE_URL_US;
  if (!url) {
    throw new ShopVerifyTerminalError("LIVE_NOT_CONFIGURED");
  }
  return url;
}

export function liveAcceptSelector(): string {
  return env.SHOP_VERIFY_LIVE_ACCEPT_SELECTOR;
}

export function liveTimeoutMs(): number {
  return env.SHOP_VERIFY_LIVE_TIMEOUT_MS;
}
