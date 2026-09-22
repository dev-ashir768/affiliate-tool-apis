import { AppError, type ErrorCode } from "../errors.js";

/**
 * Maps TikTok Shop OpenAPI gateway / auth errors to product AppErrors.
 * @see https://partner.tiktokshop.com/docv2/page/common-errors
 *
 * Note: code `36009004` is reused for many validation failures — branch on
 * message keywords, never on the numeric code alone.
 */

export type TikTokErrorCategory =
  | "rate_limit"
  | "timeout"
  | "auth"
  | "authorization"
  | "signature"
  | "timestamp"
  | "parameter"
  | "path"
  | "format"
  | "upstream"
  | "unknown";

export type TikTokMappedError = {
  appCode: ErrorCode;
  status: number;
  /** Operator-facing message (actionable). */
  message: string;
  category: TikTokErrorCategory;
  remediation: string;
  /** Keyword matched for reused codes such as 36009004. */
  messageKeyword: string | null;
};

export type TikTokOpenApiErrorBody = {
  code?: number;
  message?: string;
  request_id?: string;
};

function includesAny(haystack: string, needles: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n;
  }
  return null;
}

/**
 * Resolve 36009004 (and similar reused codes) via message keywords from
 * Partner Center "Message keyword index for 36009004".
 */
function map36009004(rawMessage: string): TikTokMappedError {
  const msg = rawMessage || "Invalid request credentials or parameters";

  if (
    includesAny(msg, ["Missing credentials"]) ||
    includesAny(msg, ["does not include a required signature", "required signature"])
  ) {
    return {
      appCode: "FAILED_PRECONDITION",
      status: 400,
      message: "TikTok request is missing a valid signature.",
      category: "signature",
      remediation:
        "Generate sign per Partner Center → Sign your API request (exclude access_token from the sign string).",
      messageKeyword: "Missing credentials, signature",
    };
  }

  if (includesAny(msg, ["x-tts-access-token header is invalid"])) {
    return {
      appCode: "UNAUTHORIZED",
      status: 401,
      message: "TikTok x-tts-access-token header is invalid.",
      category: "auth",
      remediation:
        "Pass the seller access token from Get Access Token for the correct authorization principal.",
      messageKeyword: "x-tts-access-token header is invalid",
    };
  }

  if (includesAny(msg, ["access_token header is invalid"])) {
    return {
      appCode: "UNAUTHORIZED",
      status: 401,
      message: "TikTok access_token is invalid.",
      category: "auth",
      remediation:
        "Pass the access token from Get Access Token; confirm it belongs to this app/shop.",
      messageKeyword: "access_token header is invalid",
    };
  }

  if (includesAny(msg, ["Invalid app_key"])) {
    return {
      appCode: "FAILED_PRECONDITION",
      status: 400,
      message: "TikTok app_key is invalid, disabled, or not found.",
      category: "auth",
      remediation:
        "Verify TIKTOK_SHOP_APP_KEY on Partner Center → App details (not deleted/disabled).",
      messageKeyword: "Invalid app_key",
    };
  }

  if (includesAny(msg, ["earlier than 5 minutes"])) {
    return {
      appCode: "FAILED_PRECONDITION",
      status: 400,
      message: "TikTok request timestamp is too old.",
      category: "timestamp",
      remediation:
        "Use a Unix timestamp within 5 minutes before server time (sync NTP / generate at request time).",
      messageKeyword: "timestamp, earlier than 5 minutes",
    };
  }

  if (includesAny(msg, ["more than 30 seconds"])) {
    return {
      appCode: "FAILED_PRECONDITION",
      status: 400,
      message: "TikTok request timestamp is too far in the future.",
      category: "timestamp",
      remediation:
        "Keep timestamp ≤ 30 seconds ahead of TikTok server time; check clock skew.",
      messageKeyword: "timestamp, more than 30 seconds",
    };
  }

  if (includesAny(msg, ["lesser than 0"])) {
    return {
      appCode: "FAILED_PRECONDITION",
      status: 400,
      message: "TikTok timestamp must not be negative.",
      category: "timestamp",
      remediation: "Send a positive Unix timestamp (seconds).",
      messageKeyword: "timestamp, lesser than 0",
    };
  }

  if (includesAny(msg, ["Invalid timestamp"])) {
    return {
      appCode: "FAILED_PRECONDITION",
      status: 400,
      message: "TikTok timestamp is outside the accepted window.",
      category: "timestamp",
      remediation:
        "Timestamps must be within 5 minutes before to 30 seconds beyond current time.",
      messageKeyword: "Invalid timestamp",
    };
  }

  if (includesAny(msg, ["shop_cipher, not required", "Unexpected identifier"])) {
    if (includesAny(msg, ["category_asset_cipher"])) {
      return {
        appCode: "VALIDATION_ERROR",
        status: 400,
        message: "category_asset_cipher is not required for this TikTok endpoint.",
        category: "parameter",
        remediation: "Remove category_asset_cipher and use the identifier this endpoint expects.",
        messageKeyword: "category_asset_cipher, not required",
      };
    }
    return {
      appCode: "VALIDATION_ERROR",
      status: 400,
      message: "shop_cipher is not required for this TikTok endpoint.",
      category: "parameter",
      remediation:
        "Remove shop_cipher from the query; check the endpoint's required identifier.",
      messageKeyword: "shop_cipher, not required",
    };
  }

  if (includesAny(msg, ["shop_id, invalid", "Invalid identifier"])) {
    return {
      appCode: "VALIDATION_ERROR",
      status: 400,
      message: "TikTok shop_id is invalid.",
      category: "parameter",
      remediation: "Retrieve the correct shop identifier from Get Authorized Shops.",
      messageKeyword: "shop_id, invalid",
    };
  }

  if (includesAny(msg, ["Invalid API version"])) {
    return {
      appCode: "VALIDATION_ERROR",
      status: 400,
      message: "TikTok API version is invalid or unsupported.",
      category: "parameter",
      remediation:
        "Use the version in the endpoint path (e.g. 202508) per API versioning docs.",
      messageKeyword: "Invalid API version",
    };
  }

  return {
    appCode: "FAILED_PRECONDITION",
    status: 400,
    message: `TikTok request validation failed: ${msg}`,
    category: "parameter",
    remediation:
      "Inspect message + request_id against Partner Center common errors (36009004 keyword index).",
    messageKeyword: null,
  };
}

export function mapTikTokOpenApiError(input: {
  httpStatus: number;
  body: TikTokOpenApiErrorBody | null;
  path?: string;
}): TikTokMappedError {
  const code = input.body?.code;
  const rawMessage = (input.body?.message ?? "").trim();
  const http = input.httpStatus;

  // HTTP transport signals — Partner Center recommends checking these first.
  if (http === 429 || code === 36009002) {
    return {
      appCode: "RATE_LIMITED",
      status: 429,
      message:
        rawMessage ||
        "TikTok rate limit: too many requests in a short period.",
      category: "rate_limit",
      remediation:
        "Back off and retry with jitter; respect Retry-After if present. See Partner Center → Rate limits.",
      messageKeyword: null,
    };
  }

  if (http === 408 || code === 36009007) {
    return {
      appCode: "BAD_GATEWAY",
      status: 504,
      message: rawMessage || "TikTok request timed out.",
      category: "timeout",
      remediation: "Retry, or reduce page size / split the sync into smaller batches.",
      messageKeyword: null,
    };
  }

  if (code === 36009004) {
    return map36009004(rawMessage);
  }

  if (code === 36009014) {
    return {
      appCode: "VALIDATION_ERROR",
      status: 400,
      message: rawMessage || "TikTok API version is invalid or unsupported.",
      category: "parameter",
      remediation: "Confirm the path version segment matches the endpoint reference.",
      messageKeyword: includesAny(rawMessage, ["Invalid API version"]),
    };
  }

  switch (code) {
    case 36009002:
      return {
        appCode: "RATE_LIMITED",
        status: 429,
        message: rawMessage || "Too many TikTok requests.",
        category: "rate_limit",
        remediation: "Apply exponential backoff; see Rate limits docs.",
        messageKeyword: null,
      };
    case 36009009:
      return {
        appCode: "NOT_FOUND",
        status: 404,
        message: rawMessage || "TikTok API path does not match any endpoint.",
        category: "path",
        remediation: `Verify path ${input.path ?? "(unknown)"} against the API Reference.`,
        messageKeyword: null,
      };
    case 36009010:
      return {
        appCode: "VALIDATION_ERROR",
        status: 405,
        message: rawMessage || "HTTP method not supported for this TikTok endpoint.",
        category: "path",
        remediation: "Use the method documented for this endpoint (usually POST/GET).",
        messageKeyword: null,
      };
    case 36009021:
      return {
        appCode: "VALIDATION_ERROR",
        status: 400,
        message: rawMessage || "Uploaded file exceeds TikTok size limit.",
        category: "format",
        remediation: "Reduce file size per the endpoint documentation.",
        messageKeyword: null,
      };
    case 36009022:
    case 36009023:
      return {
        appCode: "VALIDATION_ERROR",
        status: 400,
        message: rawMessage || "Invalid TikTok request Content-Type / body format.",
        category: "format",
        remediation:
          "Use application/json for structured data or multipart/form-data for files.",
        messageKeyword: null,
      };
    case 105005:
      return {
        appCode: "FORBIDDEN",
        status: 403,
        message:
          rawMessage ||
          "TikTok access denied: app or token missing required scope.",
        category: "authorization",
        remediation:
          "Enable the endpoint scope in Partner Center → Manage API, then re-authorize the seller so granted_scopes includes it (e.g. seller.creator_marketplace.read).",
        messageKeyword: null,
      };
    case 101000:
      return {
        appCode: "UNAUTHORIZED",
        status: 401,
        message:
          rawMessage ||
          "TikTok category_asset_cipher or x-tts-access-token is invalid for this endpoint.",
        category: "authorization",
        remediation:
          "Confirm token user_type matches the endpoint entity tag, and shop_cipher matches the shop bound to the token.",
        messageKeyword: null,
      };
    case 36009033:
      return {
        appCode: "FORBIDDEN",
        status: 403,
        message: rawMessage || "Caller IP is not on this app's allow list.",
        category: "authorization",
        remediation: "Add this server IP in Partner Center → App & Service IP allow list.",
        messageKeyword: null,
      };
    case 105002:
      return {
        appCode: "UNAUTHORIZED",
        status: 401,
        message: rawMessage || "TikTok access token has expired.",
        category: "auth",
        remediation:
          "Refresh via Get Refresh Token and update TIKTOK_SHOP_ACCESS_TOKEN (and refresh token).",
        messageKeyword: null,
      };
    case 106001:
      return {
        appCode: "FAILED_PRECONDITION",
        status: 401,
        message: rawMessage || "TikTok request signature is invalid.",
        category: "signature",
        remediation:
          "Re-check HMAC: path + sorted query (no sign/access_token) + exact body bytes, wrapped with app_secret.",
        messageKeyword: null,
      };
    case 106013:
      return {
        appCode: "FAILED_PRECONDITION",
        status: 400,
        message: rawMessage || "TikTok shop_cipher is required for this endpoint.",
        category: "parameter",
        remediation:
          "Set TIKTOK_SHOP_CIPHER from Get Authorized Shops for the authorized seller shop.",
        messageKeyword: null,
      };
    case 36004004:
      return {
        appCode: "VALIDATION_ERROR",
        status: 400,
        message: rawMessage || "TikTok auth_code is invalid, used, or expired.",
        category: "auth",
        remediation: "Restart seller OAuth and exchange a fresh auth_code once.",
        messageKeyword: null,
      };
    // Seller Search Creator on Marketplace (202508) — endpoint Errorcode section
    case 45101004:
      return {
        appCode: "RATE_LIMITED",
        status: 429,
        message:
          rawMessage ||
          "TikTok Creator Marketplace daily query quota reached (10,000/day).",
        category: "rate_limit",
        remediation:
          "Wait until the next UTC day before syncing again, or reduce maxPages / schedule syncs.",
        messageKeyword: null,
      };
    case 36009003:
      return {
        appCode: "BAD_GATEWAY",
        status: 502,
        message: rawMessage || "TikTok internal error. Retry shortly.",
        category: "upstream",
        remediation:
          "Retry with backoff. If it persists, escalate to TikTok support with request_id.",
        messageKeyword: null,
      };
    default:
      break;
  }

  // Rate-limits docs: 503 is service unavailable, not a quota exceed.
  if (http === 503) {
    return {
      appCode: "BAD_GATEWAY",
      status: 503,
      message: rawMessage || "TikTok service temporarily unavailable.",
      category: "upstream",
      remediation:
        "Retry after a short wait. Check Partner Center announcements if it persists.",
      messageKeyword: null,
    };
  }

  if (http === 401) {
    return {
      appCode: "UNAUTHORIZED",
      status: 401,
      message: rawMessage || "TikTok authentication failed.",
      category: "auth",
      remediation: "Verify access token, app key/secret, and request signature.",
      messageKeyword: null,
    };
  }

  if (http === 403) {
    return {
      appCode: "FORBIDDEN",
      status: 403,
      message: rawMessage || "TikTok access denied.",
      category: "authorization",
      remediation: "Check scopes, IP allow list, and shop authorization.",
      messageKeyword: null,
    };
  }

  if (http === 404) {
    return {
      appCode: "NOT_FOUND",
      status: 404,
      message: rawMessage || "TikTok endpoint not found.",
      category: "path",
      remediation: "Confirm OpenAPI base URL + path (trailing slash / version).",
      messageKeyword: null,
    };
  }

  if (http >= 500) {
    return {
      appCode: "BAD_GATEWAY",
      status: 502,
      message: rawMessage || `TikTok upstream error (HTTP ${http}).`,
      category: "upstream",
      remediation: "Retry later; include request_id when contacting TikTok support.",
      messageKeyword: null,
    };
  }

  return {
    appCode: "BAD_GATEWAY",
    status: 502,
    message:
      rawMessage ||
      (code != null
        ? `TikTok OpenAPI error (code ${code})`
        : `TikTok OpenAPI error (HTTP ${http})`),
    category: "unknown",
    remediation:
      "Check the endpoint Errorcode section and Partner Center common errors; escalate with request_id.",
    messageKeyword: null,
  };
}

/** Whether the client should retry (rate limit / transient upstream). */
export function isRetryableTikTokError(mapped: TikTokMappedError, tiktokCode?: number | null): boolean {
  if (tiktokCode === 45101004) return false; // daily quota — do not burn retries
  if (mapped.appCode === "RATE_LIMITED") return true;
  if (mapped.category === "timeout" || mapped.category === "upstream") return true;
  if (mapped.status === 503 || mapped.status === 504) return true;
  return false;
}

export function throwMappedTikTokError(input: {
  httpStatus: number;
  body: TikTokOpenApiErrorBody | null;
  path: string;
  retryAfterSec?: number | null;
}): never {
  const mapped = mapTikTokOpenApiError(input);
  throw new AppError(mapped.appCode, mapped.message, mapped.status, {
    provider: "tiktok_shop",
    tiktokCode: input.body?.code ?? null,
    requestId: input.body?.request_id ?? null,
    path: input.path,
    httpStatus: input.httpStatus,
    category: mapped.category,
    remediation: mapped.remediation,
    messageKeyword: mapped.messageKeyword,
    upstreamMessage: input.body?.message ?? null,
    retryAfterSec: input.retryAfterSec ?? null,
    retryable: isRetryableTikTokError(mapped, input.body?.code),
    docs: "https://partner.tiktokshop.com/docv2/page/common-errors",
    concepts:
      "https://partner.tiktokshop.com/docv2/page/tts-api-concepts-overview",
  });
}
