import { describe, it, expect, afterEach } from "vitest";
import { env } from "../../src/config/env.js";
import {
  assertProductionBootConfig,
  assertShopVerifySafeForEnv,
} from "../../src/lib/production-guards.js";
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

describe("assertProductionBootConfig", () => {
  const original = {
    NODE_ENV: env.NODE_ENV,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    PORTAL_BFF_SECRET: env.PORTAL_BFF_SECRET,
    PORTAL_BASE_URL: env.PORTAL_BASE_URL,
    SHOP_VERIFY_MODE: env.SHOP_VERIFY_MODE,
    PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: env.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN,
    SHOP_VERIFY_TARGET: env.SHOP_VERIFY_TARGET,
    SHOP_VERIFY_LIVE_URL_US: env.SHOP_VERIFY_LIVE_URL_US,
    SHOP_VERIFY_LIVE_URL_UK: env.SHOP_VERIFY_LIVE_URL_UK,
  };

  function setProdSafeShopVerify() {
    (env as { SHOP_VERIFY_MODE: string }).SHOP_VERIFY_MODE = "playwright";
    (env as { PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: boolean }).PLAYWRIGHT_SHOP_VERIFY_DRY_RUN =
      false;
    (env as { SHOP_VERIFY_TARGET: string }).SHOP_VERIFY_TARGET = "live";
    (env as { SHOP_VERIFY_LIVE_URL_US?: string }).SHOP_VERIFY_LIVE_URL_US =
      "https://seller-us.tiktok.com/example";
  }

  afterEach(() => {
    (env as { NODE_ENV: string }).NODE_ENV = original.NODE_ENV;
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = original.EMAIL_PROVIDER;
    (env as { PORTAL_BFF_SECRET?: string }).PORTAL_BFF_SECRET =
      original.PORTAL_BFF_SECRET;
    (env as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL =
      original.PORTAL_BASE_URL;
    (env as { SHOP_VERIFY_MODE: string }).SHOP_VERIFY_MODE =
      original.SHOP_VERIFY_MODE;
    (env as { PLAYWRIGHT_SHOP_VERIFY_DRY_RUN: boolean }).PLAYWRIGHT_SHOP_VERIFY_DRY_RUN =
      original.PLAYWRIGHT_SHOP_VERIFY_DRY_RUN;
    (env as { SHOP_VERIFY_TARGET: string }).SHOP_VERIFY_TARGET =
      original.SHOP_VERIFY_TARGET;
    (env as { SHOP_VERIFY_LIVE_URL_US?: string }).SHOP_VERIFY_LIVE_URL_US =
      original.SHOP_VERIFY_LIVE_URL_US;
    (env as { SHOP_VERIFY_LIVE_URL_UK?: string }).SHOP_VERIFY_LIVE_URL_UK =
      original.SHOP_VERIFY_LIVE_URL_UK;
  });

  it("no-ops outside production", () => {
    (env as { NODE_ENV: string }).NODE_ENV = "test";
    (env as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL = undefined;
    expect(() => assertProductionBootConfig()).not.toThrow();
  });

  it("requires PORTAL_BASE_URL in production", () => {
    (env as { NODE_ENV: string }).NODE_ENV = "production";
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = "smtp";
    (env as { PORTAL_BFF_SECRET?: string }).PORTAL_BFF_SECRET =
      "test-portal-bff-secret";
    (env as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL = undefined;
    setProdSafeShopVerify();
    expect(() => assertProductionBootConfig()).toThrow(/PORTAL_BASE_URL/);
  });

  it("requires https PORTAL_BASE_URL in production", () => {
    (env as { NODE_ENV: string }).NODE_ENV = "production";
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = "smtp";
    (env as { PORTAL_BFF_SECRET?: string }).PORTAL_BFF_SECRET =
      "test-portal-bff-secret";
    (env as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL =
      "http://portal.example.com";
    setProdSafeShopVerify();
    expect(() => assertProductionBootConfig()).toThrow(/https/);
  });

  it("passes with https PORTAL_BASE_URL and required secrets", () => {
    (env as { NODE_ENV: string }).NODE_ENV = "production";
    (env as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER = "smtp";
    (env as { PORTAL_BFF_SECRET?: string }).PORTAL_BFF_SECRET =
      "test-portal-bff-secret";
    (env as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL =
      "https://portal.example.com";
    setProdSafeShopVerify();
    expect(() => assertProductionBootConfig()).not.toThrow();
  });
});
