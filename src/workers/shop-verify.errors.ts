export type ShopVerifyReasonCode =
  | "INVITE_REJECTED"
  | "INVITE_EXPIRED"
  | "VERIFY_TIMEOUT"
  | "PLAYWRIGHT_MISSING"
  | "LIVE_NOT_CONFIGURED"
  | "INBOX_TIMEOUT"
  | "INBOX_MISCONFIGURED";

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
