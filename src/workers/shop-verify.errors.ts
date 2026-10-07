export type ShopVerifyReasonCode =
  | "INVITE_REJECTED"
  | "INVITE_EXPIRED"
  | "VERIFY_TIMEOUT"
  | "PLAYWRIGHT_MISSING"
  | "LIVE_NOT_CONFIGURED"
  | "INBOX_TIMEOUT"
  | "INBOX_MISCONFIGURED"
  | "BOT_SESSION_MISSING"
  | "BOT_SESSION_EXPIRED"
  | "INVITE_ACCEPT_NOT_FOUND";

const MESSAGES: Record<ShopVerifyReasonCode, string> = {
  INVITE_REJECTED: "Invite was rejected on the verify page",
  INVITE_EXPIRED: "Invite expired on the verify page",
  VERIFY_TIMEOUT: "Timed out waiting for invite accept",
  PLAYWRIGHT_MISSING:
    "playwright package is not installed; set PLAYWRIGHT_SHOP_VERIFY_DRY_RUN=true or npm i -D playwright",
  LIVE_NOT_CONFIGURED:
    "Live shop verify URL is not configured for this region; set SHOP_VERIFY_LIVE_URL_US / SHOP_VERIFY_LIVE_URL_UK or use SHOP_VERIFY_TARGET=fixture",
  INBOX_TIMEOUT: "Timed out waiting for invite email in bot inbox",
  INBOX_MISCONFIGURED:
    "Bot inbox IMAP is not configured; set IMAP_HOST/USER/PASS or BOT_INBOX_PROVIDER=none",
  BOT_SESSION_MISSING:
    "Your bot isn't signed in to TikTok yet. Activate the bot from the Shops page, then verify again.",
  BOT_SESSION_EXPIRED:
    "Your bot's TikTok sign-in expired. Activate the bot again from the Shops page, then verify.",
  INVITE_ACCEPT_NOT_FOUND:
    "Could not find the accept button on the TikTok invite page. Check the invite is still pending.",
};

export class ShopVerifyTerminalError extends Error {
  readonly code = "SHOP_VERIFY_TERMINAL" as const;
  readonly reasonCode: ShopVerifyReasonCode;

  constructor(reasonCode: ShopVerifyReasonCode, message?: string) {
    super(message ?? MESSAGES[reasonCode]);
    this.name = "ShopVerifyTerminalError";
    this.reasonCode = reasonCode;
  }
}

export function isShopVerifyTerminalError(
  err: unknown
): err is ShopVerifyTerminalError {
  return err instanceof ShopVerifyTerminalError;
}
