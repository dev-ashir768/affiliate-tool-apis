import { describe, it, expect } from "vitest";
import {
  subscriptionGrantsAccess,
  isManualSubscriptionId,
} from "../../src/lib/entitlements.js";

describe("subscriptionGrantsAccess", () => {
  it("grants ACTIVE / TRIALING", () => {
    expect(
      subscriptionGrantsAccess({
        status: "ACTIVE",
        currentPeriodEnd: null,
        stripeSubscriptionId: "sub_test",
      }),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({
        status: "TRIALING",
        currentPeriodEnd: new Date(Date.now() + 86400_000),
        stripeSubscriptionId: "sub_test",
      }),
    ).toBe(true);
  });

  it("time-boxes PAST_DUE with grace after period end", () => {
    const withinGrace = new Date(Date.now() - 1 * 86400_000);
    expect(
      subscriptionGrantsAccess({
        status: "PAST_DUE",
        currentPeriodEnd: withinGrace,
        stripeSubscriptionId: "sub_test",
      }),
    ).toBe(true);

    const beyondGrace = new Date(Date.now() - 10 * 86400_000);
    expect(
      subscriptionGrantsAccess({
        status: "PAST_DUE",
        currentPeriodEnd: beyondGrace,
        stripeSubscriptionId: "sub_test",
      }),
    ).toBe(false);
  });

  it("denies PAST_DUE without period end", () => {
    expect(
      subscriptionGrantsAccess({
        status: "PAST_DUE",
        currentPeriodEnd: null,
        stripeSubscriptionId: "sub_test",
      }),
    ).toBe(false);
  });

  it("detects manual subscription ids", () => {
    expect(isManualSubscriptionId("manual_org123")).toBe(true);
    expect(isManualSubscriptionId("sub_1ABC")).toBe(false);
  });

  it("denies expired manual ACTIVE grants", () => {
    expect(
      subscriptionGrantsAccess({
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() - 60_000),
        stripeSubscriptionId: "manual_org1",
      }),
    ).toBe(false);
  });

  it("grants open-ended and future manual ACTIVE", () => {
    expect(
      subscriptionGrantsAccess({
        status: "ACTIVE",
        currentPeriodEnd: null,
        stripeSubscriptionId: "manual_org1",
      }),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 86400_000),
        stripeSubscriptionId: "manual_org1",
      }),
    ).toBe(true);
  });

  it("does not deny Stripe ACTIVE with past period end", () => {
    expect(
      subscriptionGrantsAccess({
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() - 60_000),
        stripeSubscriptionId: "sub_real",
      }),
    ).toBe(true);
  });
});
