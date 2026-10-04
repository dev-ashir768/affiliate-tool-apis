import { describe, it, expect, afterEach } from "vitest";
import { env } from "../../src/config/env.js";
import { assertShopVerifySafeForEnv } from "../../src/lib/production-guards.js";
import { AppError } from "../../src/lib/errors.js";

describe("assertShopVerifySafeForEnv", () => {
  const original = {
    NODE_ENV: env.NODE_ENV,
    SHOP_VERIFY_MODE: env.SHOP_VERIFY_MODE,
    PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: env.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN,
    SHOP_VERIFY_TARGET: env.SHOP_VERIFY_TARGET,
  };

  afterEach(() => {
    (env as { NODE_ENV: string }).NODE_ENV = original.NODE_ENV;
    (env as { SHOP_VERIFY_MODE: string }).SHOP_VERIFY_MODE =
      original.SHOP_VERIFY_MODE;
    (env as { PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: boolean }).PLAYWRIGHT_SHOP_VERIFY_DRY_RUN =
      original.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN;
    (env as { SHOP_VERIFY_TARGET: string }).SHOP_VERIFY_TARGET =
      original.SHOP_VERIFY_TARGET;
  });

  it("no-ops outside production", () => {
    (env as { NODE_ENV: string }).NODE_ENV = "test";
    (env as { SHOP_VERIFY_MODE: string }).SHOP_VERIFY_MODE = "stub";
    expect(() => assertShopVerifySafeForEnv()).not.toThrow();
  });

  it("refuses stub mode in production", () => {
    (env as { NODE_ENV: string }).NODE_ENV = "production";
    (env as { SHOP_VERIFY_MODE: string }).SHOP_VERIFY_MODE = "stub";
    expect(() => assertShopVerifySafeForEnv()).toThrow(AppError);
  });
});
